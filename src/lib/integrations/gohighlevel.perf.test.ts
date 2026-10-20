// Characterization tests: the snapshot was recorded against the sequential
// implementation, so any parallel/cached rewrite must return identical output.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';

// Full-output fingerprint (every field, every opportunity, in order) plus a readable digest.
const fingerprint = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const digest = (d: any) => ({
    totals: d.totals,
    sourceBreakdown: d.sourceBreakdown,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    locations: d.locations.map((l: any) => ({ location: l.location, pipelines: l.pipelines.map((p: any) => ({
        id: p.id, totalOpen: p.totalOpen, totalValue: p.totalValue, wonCount: p.wonCount, lostCount: p.lostCount,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        stages: p.stages.map((s: any) => [s.id, s.count, s.value, s.opportunities[0]?.id, s.opportunities.at(-1)?.id]),
    })) })),
});

const store = vi.hoisted(() => new Map<string, unknown>());
vi.mock('@/lib/api-usage-tracker', () => ({ trackCall: () => {} }));
vi.mock('@/lib/pg-cache', () => ({
    pgCacheGet: async (k: string) => (store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : null),
    pgCacheSet: async (k: string, v: unknown) => { store.set(k, JSON.parse(JSON.stringify(v))); },
}));

const LOCS = { 'k-decatur': 'decatur', 'k-smyrna': 'smyrna', 'k-kennesaw': 'kennesaw' } as const;
let calls = 0;

// Each location has 2 pipelines x 2 stages. Open opps span 3 pages. Later calls
// resolve faster than earlier ones, so any ordering bug in a parallel rewrite shows up.
function stubGhl() {
    calls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
        const n = ++calls;
        await new Promise(r => setTimeout(r, Math.max(0, 30 - n)));
        const key = init.headers.Authorization.replace('Bearer ', '') as keyof typeof LOCS;
        const loc = LOCS[key];
        const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => '' });
        if (url.endsWith('/pipelines/')) {
            return ok({ pipelines: ['pa', 'pb'].map(p => ({ id: `${loc}-${p}`, name: `${loc} ${p}`, stages: [{ id: `${loc}-${p}-s1`, name: 'New' }, { id: `${loc}-${p}-s2`, name: 'Quoted' }] })) });
        }
        const u = new URL(url);
        const pipelineId = u.pathname.match(/pipelines\/([^/]+)\/opportunities/)![1];
        const status = u.searchParams.get('status');
        if (status !== 'open') return ok({ meta: { total: pipelineId.length + status!.length } });
        const page = Number(u.searchParams.get('startAfter') || 0);
        const opps = Array.from({ length: page < 2 ? 100 : 7 }, (_, i) => ({
            id: `${pipelineId}-${page}-${i}`,
            name: `Lead ${i}`,
            monetaryValue: (i % 4) * 25,
            pipelineId,
            pipelineStageId: i % 5 === 0 ? 'unknown-stage' : `${pipelineId}-s${(i % 2) + 1}`,
            status: 'open',
            source: ['Facebook', 'Google Ads', '', 'Website'][i % 4],
            contact: { id: `c-${pipelineId}-${page}-${i}`, name: `Lead ${i}`, dateUpdated: i % 3 === 0 ? '2026-10-10T00:00:00Z' : undefined },
            createdAt: '2026-09-01T00:00:00Z',
            updatedAt: '2026-09-02T00:00:00Z',
        }));
        return ok({ opportunities: opps, meta: page < 2 ? { nextPage: page + 2, startAfter: page + 1, startAfterId: 'x' } : {} });
    }));
}

async function load() {
    vi.resetModules();
    return import('./gohighlevel');
}

describe('getFullPipelineData output is unchanged by the parallel + shared-cache rewrite', () => {
    beforeEach(() => {
        store.clear();
        vi.stubEnv('GHL_LOCATION_ID_DECATUR', 'L-d'); vi.stubEnv('GHL_API_KEY_DECATUR', 'k-decatur');
        vi.stubEnv('GHL_LOCATION_ID_SMYRNA', 'L-s'); vi.stubEnv('GHL_API_KEY_SMYRNA', 'k-smyrna');
        vi.stubEnv('GHL_LOCATION_ID_KENNESAW', 'L-k'); vi.stubEnv('GHL_API_KEY_KENNESAW', 'k-kennesaw');
        stubGhl();
    });
    afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

    it('matches the recorded output for all locations and for one location', async () => {
        const { getFullPipelineData } = await load();
        const all = await getFullPipelineData();
        const { fetchedAt: _a, ...allRest } = all;
        expect(digest(allRest)).toMatchSnapshot();
        expect(fingerprint(allRest)).toMatchSnapshot();
        const one = await getFullPipelineData({ locationFilter: 'smyrna', forceRefresh: true });
        const { fetchedAt: _b, ...oneRest } = one;
        expect(digest(oneRest)).toMatchSnapshot();
        expect(fingerprint(oneRest)).toMatchSnapshot();
    });

    it('shares one fetch between concurrent cold callers, and a new instance reads the shared cache', async () => {
        const { getFullPipelineData, getStaleLeads } = await load();
        await Promise.all([getFullPipelineData(), getStaleLeads()]);
        const firstRun = calls;
        // A different serverless instance (fresh module) must not refetch.
        const fresh = await load();
        await fresh.getFullPipelineData({ locationFilter: 'decatur' });
        expect(calls).toBe(firstRun);
        // 3 locations x (1 pipelines call + 2 pipelines x (3 open pages + 3 counts))
        expect(firstRun).toBe(3 * (1 + 2 * 6));
    });

    it('retries a 429 instead of failing the whole pipeline', async () => {
        const realFetch = globalThis.fetch as unknown as (...a: unknown[]) => Promise<unknown>;
        let throttled = false;
        vi.stubGlobal('setTimeout', (fn: () => void) => { fn(); return 0; });
        vi.stubGlobal('fetch', vi.fn(async (...args: unknown[]) => {
            if (!throttled) { throttled = true; return { ok: false, status: 429, json: async () => ({}), text: async () => 'slow down' }; }
            return realFetch(...args);
        }));
        const { getFullPipelineData } = await load();
        await expect(getFullPipelineData()).resolves.toMatchObject({ totals: expect.objectContaining({ totalOpen: 3 * 2 * 207 }) });
    });

    it('matches the recorded stale-lead list', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-19T12:00:00Z'));
        const { getStaleLeads } = await load();
        const stale = await getStaleLeads();
        vi.useRealTimers();
        expect(stale.length).toBeGreaterThan(0);
        expect(stale.slice(0, 5).map(s => [s.opportunity.id, s.daysSinceActivity, s.staleness, s.stageName])).toMatchSnapshot();
        expect(fingerprint(stale)).toMatchSnapshot();
    });
});
