import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({ leads: vi.fn(), emails: vi.fn() }));
vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { isAdmin: true } }) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/db/sql', () => ({ sql: async () => ({ rows: [] }) }));
vi.mock('@/lib/integrations/gohighlevel', () => ({ getLocations: () => [] }));
vi.mock('@/lib/integrations/mindbody-db', () => ({
    getClientEmailMapFromDB: h.emails,
    getAppointmentsByClientIds: async () => new Map(),
}));
vi.mock('@/lib/integrations/meta-ads', () => ({
    isMetaAdsConfigured: () => true,
    getMetaAdsData: async () => ({
        isMock: false,
        account: { totalSpend: 4532 },
        campaigns: [{ id: 'c1', name: 'Botox Leads', spend: 4532, costPerResult: 17, roas: 0 }],
    }),
    getMetaLeads: h.leads,
}));

import { GET } from './route';

describe('GET /api/paid-ads/roas', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-19T19:00:00'));
        h.leads.mockReset().mockResolvedValue({ leads: [], byCampaign: new Map(), totalLeads: 52, hasLeadForms: true });
        h.emails.mockReset().mockResolvedValue(new Map());
    });
    afterEach(() => vi.useRealTimers());

    it('reports True ROAS as unavailable instead of ~0x when the window is older than Meta keeps leads', async () => {
        const res = await GET(new NextRequest('http://x/api/paid-ads/roas?since=2026-07-01&until=2026-07-31'));
        const body = await res.json();
        expect(res.status).toBe(200);
        expect(body.trueRoas).toBeNull();
        expect(body.costPerMatchedClient).toBeNull();
        expect(body.attributionMethod).toBe('outside_lead_retention');
        expect(body.attributionNote).toMatch(/90 days/);
        expect(body.metaSpend).toBe(4532);
        expect(body.campaignBreakdown).toEqual([]);
        expect(h.leads).not.toHaveBeenCalled();
    });

    it('still matches leads for a window inside the last 90 days', async () => {
        const res = await GET(new NextRequest('http://x/api/paid-ads/roas?since=2026-09-20&until=2026-10-19'));
        expect((await res.json()).attributionMethod).not.toBe('outside_lead_retention');
        expect(h.leads).toHaveBeenCalled();
    });
});
