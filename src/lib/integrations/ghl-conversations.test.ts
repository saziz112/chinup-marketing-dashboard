import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';

const h = vi.hoisted(() => ({ store: new Map<string, unknown>(), pipelineCalls: 0 }));
vi.mock('@/lib/api-usage-tracker', () => ({ trackCall: () => {} }));
vi.mock('@/lib/db/sql', () => ({ sql: async () => ({ rows: [] }) }));
vi.mock('@/lib/pg-cache', () => ({
    pgCacheGet: async (k: string) => (h.store.has(k) ? JSON.parse(JSON.stringify(h.store.get(k))) : null),
    pgCacheSet: async (k: string, v: unknown) => { h.store.set(k, JSON.parse(JSON.stringify(v))); },
}));
vi.mock('@/lib/integrations/mindbody-db', () => {
    const down = async () => { throw new Error('no db in tests'); };
    return { getClientMatchMapsFromDB: down, getPurchasingClientsFromDB: down, getAppointmentsFromDB: down, getClientsFromDB: down, toApiClient: (c: unknown) => c, saleDateString: (d: string) => d };
});

type Loc = 'decatur' | 'smyrna' | 'kennesaw';
const LOC_NAMES: Record<Loc, string> = { decatur: 'Decatur', smyrna: 'Smyrna/Vinings', kennesaw: 'Kennesaw' };
const LOCS: Loc[] = ['decatur', 'smyrna', 'kennesaw'];
const N = 180; // above the 150-contact cap

// Contact i lives at LOCS[i % 3]. Contacts 0 and 1 share a phone across two locations.
const phoneOf = (i: number) => (i === 1 ? '(404) 555-0000' : `404555${String(i).padStart(4, '0')}`);
const opp = (i: number) => ({
    id: `o${i}`, name: `Lead ${i}`, monetaryValue: (i * 37) % 500, pipelineId: 'p', pipelineStageId: 's',
    status: i % 17 === 0 ? 'won' : 'open', source: ['Facebook', 'Google Ads', 'Website'][i % 3],
    contactId: `c${i}`, contactName: `Lead ${i}`, contactEmail: `l${i}@x.com`, contactPhone: phoneOf(i), contactTags: [],
    contactDND: false, assignedTo: null,
    createdAt: new Date(Date.UTC(2026, 3, 1) + i * 86400000).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 4, 1) + i * 86400000).toISOString(),
    lastStatusChangeAt: new Date(Date.UTC(2026, 4, 1) + i * 86400000).toISOString(),
    locationKey: LOCS[i % 3],
});

vi.mock('@/lib/integrations/gohighlevel', () => {
    const all = Array.from({ length: N }, (_, i) => opp(i));
    return {
        getLocations: () => [],
        getStaleLeads: async () => all.filter((_, i) => i % 4 === 0).map(o => ({
            opportunity: o, daysSinceActivity: 40, staleness: 'stale', lastActivitySource: 'opportunity',
            locationKey: o.locationKey, locationName: LOC_NAMES[o.locationKey as Loc], pipelineName: 'Leads', stageName: 'New',
        })),
        getFullPipelineData: async () => {
            h.pipelineCalls++;
            return {
                locations: LOCS.map(l => ({
                    location: l, locationName: LOC_NAMES[l],
                    pipelines: [{ id: 'p', name: 'Leads', stages: [{ id: 's', name: 'Quoted', position: 0, opportunities: all.filter(o => o.locationKey === l) }] }],
                })),
                totals: {}, sourceBreakdown: [], fetchedAt: '',
            };
        },
    };
});

// Conversation/message history derived from the contact index. Decatur answers
// slowest so a parallel rewrite that merges out of order would change phone de-dupe.
function stubV2() {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
        const pit = init.headers.Authorization.replace('Bearer ', '');
        const ticks = pit === 'pit-decatur' ? 40 : pit === 'pit-smyrna' ? 5 : 15;
        for (let k = 0; k < ticks; k++) await Promise.resolve();
        const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => '' });
        const u = new URL(url);
        if (u.pathname === '/conversations/search') {
            const i = Number(u.searchParams.get('contactId')!.slice(1));
            const convs = i % 7 === 3 ? [] : [{ id: `conv${i}`, contactName: `Lead ${i}`, phone: phoneOf(i), email: `l${i}@x.com`, tags: i % 11 === 0 ? ['dnd'] : [] }];
            return ok({ conversations: convs });
        }
        const i = Number(u.pathname.split('/')[2].slice(4));
        const base = Date.UTC(2026, 4, 1) + (i % 60) * 86400000;
        const msgs = [];
        const count = i % 6;
        for (let m = 0; m < count; m++) {
            msgs.push({
                id: `m${i}-${m}`,
                direction: (m + i) % 3 === 0 ? 'inbound' : 'outbound',
                messageType: ['TYPE_SMS', 'TYPE_CALL', 'TYPE_EMAIL'][m % 3],
                body: m === 1 && i % 4 === 0 ? 'Our special price is $199' : 'hi',
                dateAdded: new Date(base + m * 3 * 86400000).toISOString(),
                userId: m % 2 ? `u${i % 4}` : undefined,
                callDuration: m % 3 === 1 ? 60 : undefined,
            });
        }
        return ok({ messages: { messages: msgs } });
    }));
}

const fingerprint = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

async function load() {
    vi.resetModules();
    return import('./ghl-conversations');
}

describe('getConversationsIntelligence', () => {
    beforeEach(() => {
        h.store.clear();
        h.pipelineCalls = 0;
        for (const l of LOCS) { vi.stubEnv(`GHL_LOCATION_ID_${l.toUpperCase()}`, `L-${l}`); vi.stubEnv(`GHL_PIT_${l.toUpperCase()}`, `pit-${l}`); }
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-19T12:00:00Z'));
        // Skip the 300ms rate-limit pauses between batches.
        vi.stubGlobal('setTimeout', (fn: () => void) => { fn(); return 0; });
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        stubV2();
    });
    afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

    it('matches the recorded output (parallel rewrite must not change any number)', async () => {
        const { getConversationsIntelligence } = await load();
        const { fetchedAt: _f, ...intel } = await getConversationsIntelligence();
        expect({ lifecycleCounts: intel.lifecycleCounts, summary: intel.summary, ghostAnalytics: intel.ghostAnalytics }).toMatchSnapshot();
        expect(intel.engagementGaps.slice(0, 3).map(g => [g.opportunity.id, g.daysSinceOutreach, g.riskLevel, g.callPriority])).toMatchSnapshot();
        // sample/_sampleByLocation are new fields; everything that existed before must be identical.
        const { sample: _s, _sampleByLocation: _sl, ...rest } = intel as typeof intel & { sample?: unknown; _sampleByLocation?: unknown };
        expect(fingerprint(rest)).toMatchSnapshot();
    });

    it('says the lifecycle and ghost stats are a sample, and how big', async () => {
        const { getConversationsIntelligence } = await load();
        const intel = await getConversationsIntelligence();
        const funnelTotal = Object.values(intel.lifecycleCounts).reduce((a, b) => a + b, 0);
        expect(intel.sample).toEqual({ analyzed: funnelTotal, eligible: N, cap: 150, selection: 'highest value and most recent first' });
        expect(funnelTotal).toBeLessThanOrEqual(150);

        // A location view (derived from the cached all-locations run) carries its own sample size.
        const smyrna = await getConversationsIntelligence({ locationFilter: 'smyrna' });
        const smyrnaTotal = Object.values(smyrna.lifecycleCounts).reduce((a, b) => a + b, 0);
        expect(smyrna.sample).toMatchObject({ analyzed: smyrnaTotal, eligible: N / 3 });
    });

    it('serves another serverless instance from the shared cache without calling GHL', async () => {
        const first = await (await load()).getConversationsIntelligence();
        const fetchMock = globalThis.fetch as unknown as { mock: { calls: unknown[] } };
        const callsAfterFirst = fetchMock.mock.calls.length;
        const second = await (await load()).getConversationsIntelligence();
        expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
        expect(second).toEqual(JSON.parse(JSON.stringify(first)));
    });
});
