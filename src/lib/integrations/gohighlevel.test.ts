import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/api-usage-tracker', () => ({ trackCall: () => {} }));

const opp = (id: string, value: number, source: string) => ({
    id, monetaryValue: value, source, pipelineId: 'p1', pipelineStageId: 's1', status: 'open',
    createdAt: '2026-10-01', updatedAt: '2026-10-01',
});

// Decatur: 2 open ($100 + $50) where page 2 repeats o2; 3 won, 1 lost. Smyrna: 1 open ($900), 10 won, 0 lost.
function stubGhl(opts: { smyrnaDown?: boolean } = {}) {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
        const key = init.headers.Authorization.replace('Bearer ', '');
        const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => '' });
        if (key === 'k-smyrna' && opts.smyrnaDown) return { ok: false, status: 401, json: async () => ({}), text: async () => 'bad key' };
        if (url.endsWith('/pipelines/')) return ok({ pipelines: [{ id: 'p1', name: 'Leads', stages: [{ id: 's1', name: 'New' }] }] });
        const status = new URL(url).searchParams.get('status');
        const counts: Record<string, Record<string, number>> = { 'k-decatur': { won: 3, lost: 1, abandoned: 0 }, 'k-smyrna': { won: 10, lost: 0, abandoned: 0 } };
        if (status !== 'open') return ok({ meta: { total: counts[key][status!] } });
        if (key === 'k-smyrna') return ok({ opportunities: [opp('s1', 900, 'Facebook')], meta: {} });
        const page2 = url.includes('startAfterId=');
        if (!page2) return ok({ opportunities: [opp('o1', 100, 'Facebook'), ...Array.from({ length: 98 }, () => null).map((_, i) => ({ ...opp(`x${i}`, 0, 'Website') })), opp('o2', 50, 'Google Ads')], meta: { nextPage: 2, startAfter: 1, startAfterId: 'o2' } });
        return ok({ opportunities: [opp('o2', 50, 'Google Ads')], meta: {} });
    }));
}

async function load() {
    vi.resetModules();
    return import('./gohighlevel');
}

describe('getFullPipelineData', () => {
    beforeEach(() => {
        vi.stubEnv('GHL_LOCATION_ID_DECATUR', 'L-d'); vi.stubEnv('GHL_API_KEY_DECATUR', 'k-decatur');
        vi.stubEnv('GHL_LOCATION_ID_SMYRNA', 'L-s'); vi.stubEnv('GHL_API_KEY_SMYRNA', 'k-smyrna');
        vi.stubEnv('GHL_LOCATION_ID_KENNESAW', ''); vi.stubEnv('GHL_API_KEY_KENNESAW', '');
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

    it('scopes the headline totals and source breakdown to the selected location, fresh and cached', async () => {
        stubGhl();
        const { getFullPipelineData } = await load();
        for (const _ of [1, 2]) {
            const d = await getFullPipelineData({ locationFilter: 'smyrna' });
            expect(d.totals).toMatchObject({ totalOpen: 1, totalValue: 900, totalWon: 10, totalLost: 0, conversionRate: 100 });
            expect(d.sourceBreakdown).toEqual([{ source: 'Facebook', count: 1, value: 900 }]);
        }
    });

    it('counts an opportunity repeated across a page boundary once', async () => {
        stubGhl();
        const { getFullPipelineData } = await load();
        const d = await getFullPipelineData({ locationFilter: 'decatur' });
        expect(d.totals.totalOpen).toBe(100);
        expect(d.totals.totalValue).toBe(150);
    });

    it('throws when a location fails instead of caching it as zero', async () => {
        stubGhl({ smyrnaDown: true });
        const { getFullPipelineData } = await load();
        await expect(getFullPipelineData()).rejects.toThrow(/401/);
        stubGhl();
        expect((await getFullPipelineData()).totals.totalWon).toBe(13);
    });
});
