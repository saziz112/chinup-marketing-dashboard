import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
    getPipelines: vi.fn(),
    getOpportunities: vi.fn(),
    emailMap: vi.fn(),
    appts: vi.fn(),
}));
vi.mock('./gohighlevel', () => ({
    getLocations: () => [{ key: 'decatur', locationId: 'L1' }, { key: 'smyrna', locationId: 'L2' }],
    getPipelines: h.getPipelines,
    getOpportunities: h.getOpportunities,
}));
vi.mock('./mindbody-db', () => ({ getClientEmailMapFromDB: h.emailMap, getAppointmentsByClientIds: h.appts }));

async function load() {
    vi.resetModules();
    return import('./google-ads');
}

const ENV = ['GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN', 'GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID', 'GOOGLE_ADS_LOGIN_CUSTOMER_ID'];

describe('getGoogleAdsData', () => {
    beforeEach(() => {
        for (const k of ENV) vi.stubEnv(k, 'x');
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

    it('throws on an API error instead of returning mock data', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, text: async () => 'invalid_grant' }) as unknown as Response));
        const { getGoogleAdsData } = await load();
        await expect(getGoogleAdsData('2026-09-20', '2026-10-19')).rejects.toThrow(/invalid_grant/);
    });

    it('throws when credentials are missing instead of returning mock data', async () => {
        vi.stubEnv('GOOGLE_ADS_REFRESH_TOKEN', '');
        const { getGoogleAdsData } = await load();
        await expect(getGoogleAdsData('2026-09-20', '2026-10-19')).rejects.toThrow(/not configured/i);
    });
});

describe('getGhlGoogleLeads', () => {
    beforeEach(() => {
        h.getPipelines.mockReset().mockResolvedValue([{ id: 'p1' }]);
        h.getOpportunities.mockReset().mockResolvedValue({ opportunities: [] });
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => vi.restoreAllMocks());

    it('throws when one location fails, and does not cache the partial count', async () => {
        h.getPipelines.mockImplementation(async (loc: { key: string }) => {
            if (loc.key === 'smyrna') throw new Error('GHL 429');
            return [{ id: 'p1' }];
        });
        const { getGhlGoogleLeads } = await load();
        await expect(getGhlGoogleLeads('2026-09-20', '2026-10-19')).rejects.toThrow(/429/);
        h.getPipelines.mockResolvedValue([{ id: 'p1' }]);
        await expect(getGhlGoogleLeads('2026-09-20', '2026-10-19')).resolves.toEqual({ count: 0, opportunities: [] });
    });
});

describe('enrichGhlLeadsWithMindBody', () => {
    const lead = (email: string) => ({ id: email, name: 'n', source: 'Google Ads', status: 'open', createdAt: '2026-10-01', contactId: 'c', contactEmail: email,
        location: 'decatur', ghlUrl: null, mbClientId: null, mbRevenue: 0, mbBooked: 0, mbCompleted: 0 });

    beforeEach(() => { h.emailMap.mockReset(); h.appts.mockReset().mockResolvedValue(new Map()); });

    it('surfaces a POS lookup failure instead of reporting 0x ROAS', async () => {
        h.emailMap.mockRejectedValue(new Error('db down'));
        const { enrichGhlLeadsWithMindBody } = await load();
        await expect(enrichGhlLeadsWithMindBody([lead('a@x.com')] as never, '2026-09-20', '2026-10-19')).rejects.toThrow(/db down/);
    });

    it('surfaces an appointment lookup failure instead of reporting 0 booked', async () => {
        h.emailMap.mockResolvedValue(new Map([['a@x.com', { client: { Id: 'A' }, revenue: 500 }]]));
        h.appts.mockRejectedValue(new Error('appts down'));
        const { enrichGhlLeadsWithMindBody } = await load();
        await expect(enrichGhlLeadsWithMindBody([lead('a@x.com')] as never, '2026-09-20', '2026-10-19')).rejects.toThrow(/appts down/);
    });

    it('counts a lead as matched only when that person bought in the window', async () => {
        h.emailMap.mockResolvedValue(new Map([
            ['a@x.com', { client: { Id: 'A' }, revenue: 500 }],
            ['b@x.com', { client: { Id: 'B' }, revenue: 0 }],
        ]));
        const { enrichGhlLeadsWithMindBody } = await load();
        const res = await enrichGhlLeadsWithMindBody([lead('a@x.com'), lead('b@x.com')] as never, '2026-09-20', '2026-10-19');
        expect(res.totals.mbMatchedClients).toBe(1);
        expect(res.totals.totalRevenue).toBe(500);
    });

    it('counts people who booked from their earliest lead date, not appointments', async () => {
        h.emailMap.mockResolvedValue(new Map([
            ['a@x.com', { client: { Id: 'A' }, revenue: 0 }],
            ['b@x.com', { client: { Id: 'B' }, revenue: 0 }],
        ]));
        h.appts.mockResolvedValue(new Map([['A', { booked: 4, completed: 3, noShow: 0 }]]));
        const { enrichGhlLeadsWithMindBody } = await load();
        const a2 = { ...lead('a@x.com'), id: 'a2', createdAt: '2026-09-25T10:00:00Z' };
        const res = await enrichGhlLeadsWithMindBody([lead('a@x.com'), a2, lead('b@x.com')] as never, '2026-09-20', '2026-10-19');
        expect(h.appts).toHaveBeenCalledWith([
            { clientId: 'A', leadDate: '2026-10-01' },
            { clientId: 'A', leadDate: '2026-09-25' },
            { clientId: 'B', leadDate: '2026-10-01' },
        ]);
        expect(res.totals.appointmentsBooked).toBe(1);
        expect(res.totals.appointmentsCompleted).toBe(1);
    });
});

