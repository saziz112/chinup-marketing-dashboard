// Characterization tests: snapshots were recorded against the sequential
// implementation, so the parallel + shared-cache rewrite must return identical output.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';

const h = vi.hoisted(() => ({ store: new Map<string, unknown>(), oppCalls: 0, track: [] as unknown[][] }));
vi.mock('@/lib/api-usage-tracker', () => ({ trackCall: (...a: unknown[]) => { h.track.push(a); } }));
vi.mock('@/lib/pg-cache', () => ({
    pgCacheGet: async (k: string) => (h.store.has(k) ? JSON.parse(JSON.stringify(h.store.get(k))) : null),
    pgCacheSet: async (k: string, v: unknown) => { h.store.set(k, JSON.parse(JSON.stringify(v))); },
    // Like pg-cache's memory tier: every caller gets the same stored object.
    pgCached: async (k: string, _o: unknown, load: () => Promise<unknown>) => {
        if (!h.store.has(k)) h.store.set(k, await load());
        return h.store.get(k);
    },
}));
vi.mock('./mindbody-db', () => ({ getClientEmailMapFromDB: vi.fn(), getAppointmentsByClientIds: vi.fn() }));
vi.mock('./gohighlevel', () => ({
    getLocations: () => ['decatur', 'smyrna', 'kennesaw'].map(key => ({ key, locationId: `L-${key}` })),
    getPipelines: async (loc: { key: string }) => [{ id: `${loc.key}-pa` }, { id: `${loc.key}-pb` }],
    getOpportunities: async (loc: { key: string }, pipelineId: string, opts: { status: string }) => {
        const n = ++h.oppCalls;
        await new Promise(r => setTimeout(r, Math.max(0, 25 - n)));
        const sources = ['Google Ads - Form', 'Facebook', 'Website', 'google organic'];
        const names = ['Jane', 'Bob - Google Ad', 'Sam', 'Ann'];
        return {
            opportunities: Array.from({ length: 12 }, (_, i) => ({
                id: `${pipelineId}-${opts.status}-${i}`,
                name: names[i % 4],
                source: sources[(i + pipelineId.length) % 4],
                createdAt: `2026-${i % 2 ? '10' : '08'}-${String(10 + i).padStart(2, '0')}T12:00:00Z`,
                status: opts.status,
                contactId: i % 5 ? `c${i}` : '',
                contactName: names[i % 4],
                contactEmail: `${pipelineId}${i}@x.com`,
                monetaryValue: i * 10,
            })),
            total: 12,
        };
    },
}));

const ENV = ['GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN', 'GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID', 'GOOGLE_ADS_LOGIN_CUSTOMER_ID'];
const fingerprint = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

async function load() {
    vi.resetModules();
    return import('./google-ads');
}

function stubAdsApi() {
    const fetchMock = vi.fn(async (url: string, init: { body: string }) => {
        const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => '' }) as unknown as Response;
        if (url.includes('oauth2')) return ok({ access_token: 't' });
        const q = JSON.parse(init.body).query as string;
        await new Promise(r => setTimeout(r, q.includes('FROM campaign') ? 1 : 15));
        if (q.includes('FROM campaign')) {
            return ok({ results: [
                { campaign: { id: 11, name: 'Botox Search', status: 'ENABLED', advertisingChannelType: 'SEARCH', startDateTime: '2026-01-02' }, metrics: { costMicros: '123456789', impressions: '4000', clicks: '210', conversions: '12.6', conversionsValue: '900.5' } },
                { campaign: { id: 12, name: 'PMax', status: 'PAUSED', advertisingChannelType: 'PERFORMANCE_MAX' }, metrics: { costMicros: '5000000', impressions: '100', clicks: '0', conversions: '0' } },
            ] });
        }
        if (q.includes('ORDER BY segments.date')) {
            return ok({ results: [
                { segments: { date: '2026-10-01' }, metrics: { costMicros: '64228394', impressions: '2100', clicks: '110', conversions: '6.2' } },
                { segments: { date: '2026-10-02' }, metrics: { costMicros: '64228395', impressions: '2000', clicks: '100', conversions: '6.4' } },
            ] });
        }
        return ok({ results: [{ customer: { id: 999, descriptiveName: 'Chin Up', currencyCode: 'USD', timeZone: 'America/New_York' }, metrics: { costMicros: '128456789', impressions: '4100', clicks: '210', conversions: '12.6' } }] });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

describe('Google Ads output is unchanged by the parallel + shared-cache rewrite', () => {
    beforeEach(() => {
        h.store.clear();
        h.oppCalls = 0;
        h.track = [];
        for (const k of ENV) vi.stubEnv(k, 'x');
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

    it('getGoogleAdsData matches the recorded output', async () => {
        stubAdsApi();
        const { getGoogleAdsData } = await load();
        expect(await getGoogleAdsData('2026-09-20', '2026-10-19')).toMatchSnapshot();
    });

    it('getGhlGoogleLeads matches the recorded output, in order', async () => {
        const { getGhlGoogleLeads } = await load();
        const res = await getGhlGoogleLeads('2026-09-20', '2026-10-19');
        expect(res.count).toMatchSnapshot();
        expect(res.opportunities.slice(0, 4).map(o => [o.id, o.locationKey, o.source, o.ghlUrl])).toMatchSnapshot();
        expect(fingerprint(res)).toMatchSnapshot();
    });

    it('serves a repeat load on another instance from the shared cache, and logs usage', async () => {
        const fetchMock = stubAdsApi();
        const a = await load();
        await a.getGoogleAdsData('2026-09-20', '2026-10-19');
        await a.getGhlGoogleLeads('2026-09-20', '2026-10-19');
        const [adsCalls, oppCalls] = [fetchMock.mock.calls.length, h.oppCalls];
        const b = await load();
        await b.getGoogleAdsData('2026-09-20', '2026-10-19');
        await b.getGhlGoogleLeads('2026-09-20', '2026-10-19');
        expect([fetchMock.mock.calls.length, h.oppCalls]).toEqual([adsCalls, oppCalls]);
        expect(h.track.filter(t => t[0] === 'googleAds' && t[2] === false)).toHaveLength(3);
        expect(h.track.filter(t => t[0] === 'googleAds' && t[2] === true)).toHaveLength(1);
    });

    it('hands out copies so MindBody enrichment never leaks into the cached leads', async () => {
        const { getGhlGoogleLeads } = await load();
        const first = await getGhlGoogleLeads('2026-09-20', '2026-10-19');
        first.opportunities[0].mbRevenue = 999;
        const again = await getGhlGoogleLeads('2026-09-20', '2026-10-19');
        expect(again.opportunities[0].mbRevenue).toBe(0);
    });
});
