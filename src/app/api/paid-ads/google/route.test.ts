import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({ enrich: vi.fn(), isAdmin: true }));
vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { isAdmin: h.isAdmin } }) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/db/sql', () => ({ sql: async () => ({ rows: [] }) }));
vi.mock('@/lib/integrations/google-ads', () => ({
    isGoogleAdsConfigured: () => true,
    getGoogleAdsData: async () => ({ isMock: false, account: { totalSpend: 1000 }, campaigns: [], dailySpend: [] }),
    getGhlGoogleLeads: async () => ({ opportunities: [{ id: 'o1' }] }),
    enrichGhlLeadsWithMindBody: h.enrich,
}));

import { GET } from './route';

describe('GET /api/paid-ads/google', () => {
    beforeEach(() => {
        h.isAdmin = true;
        h.enrich.mockReset().mockResolvedValue({
            leads: [{ id: 'o1', mbRevenue: 500 }],
            totals: { totalLeads: 1, mbMatchedClients: 1, mbMatchRate: 100, totalRevenue: 500, appointmentsBooked: 1, appointmentsCompleted: 1 },
        });
    });

    it('serves a repeat load of the same window without re-running the revenue match', async () => {
        const url = 'http://x/api/paid-ads/google?since=2026-09-01&until=2026-09-30';
        const first = await (await GET(new NextRequest(url))).json();
        const second = await (await GET(new NextRequest(url))).json();
        expect(second).toEqual(first);
        expect(first.ghlTrueRoas).toBe(0.5);
        expect(h.enrich).toHaveBeenCalledTimes(1);
    });

    it('still redacts revenue for non-admins when the match comes from cache', async () => {
        const url = 'http://x/api/paid-ads/google?since=2026-08-01&until=2026-08-31';
        await GET(new NextRequest(url));
        h.isAdmin = false;
        const body = await (await GET(new NextRequest(url))).json();
        expect(body.ghlTotalRevenue).toBeNull();
        expect(body.ghlLeadsDetails[0].mbRevenue).toBe(0);
        expect(h.enrich).toHaveBeenCalledTimes(1);
    });
});
