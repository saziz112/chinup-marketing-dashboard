import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({ leads: vi.fn(), emails: vi.fn(), appts: vi.fn() }));
vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { isAdmin: true } }) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/db/sql', () => ({ sql: async () => ({ rows: [] }) }));
vi.mock('@/lib/integrations/gohighlevel', () => ({ getLocations: () => [] }));
vi.mock('@/lib/integrations/mindbody-db', () => ({
    getClientEmailMapFromDB: h.emails,
    getAppointmentsByClientIds: h.appts,
}));
vi.mock('@/lib/integrations/meta-ads', () => ({
    isMetaAdsConfigured: () => true,
    getMetaAdsData: async () => ({
        isMock: false,
        account: { totalSpend: 4532 },
        campaigns: [
            { id: 'c1', name: 'Botox Leads', spend: 4532, costPerResult: 17, roas: 0 },
            { id: 'c2', name: 'Filler Leads', spend: 1000, costPerResult: 20, roas: 0 },
        ],
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
        h.appts.mockReset().mockResolvedValue(new Map());
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

    it('counts people who booked, once each, under their first campaign only', async () => {
        const lead = (email: string, campaignId: string, createdTime: string) =>
            ({ email, campaignId, campaignName: '', createdTime });
        h.leads.mockResolvedValue({
            leads: [
                lead('a@x.com', 'c2', '2026-10-05T12:00:00+0000'),
                lead('a@x.com', 'c1', '2026-10-01T12:00:00+0000'),
                lead('b@x.com', 'c1', '2026-10-02T12:00:00+0000'),
                lead('c@x.com', 'c2', '2026-10-03T12:00:00+0000'),
            ],
            byCampaign: new Map(),
            totalLeads: 4,
            hasLeadForms: true,
        });
        h.emails.mockResolvedValue(new Map([
            ['a@x.com', { client: { Id: 'A' }, revenue: 0 }],
            ['b@x.com', { client: { Id: 'B' }, revenue: 0 }],
            ['c@x.com', { client: { Id: 'C' }, revenue: 0 }],
        ]));
        // A has three appointments and two shows; B booked and no-showed; C never booked.
        h.appts.mockResolvedValue(new Map([
            ['A', { booked: 3, completed: 2, noShow: 0 }],
            ['B', { booked: 1, completed: 0, noShow: 1 }],
        ]));

        const res = await GET(new NextRequest('http://x/api/paid-ads/roas?since=2026-09-20&until=2026-10-19'));
        const body = await res.json();

        expect(h.appts).toHaveBeenCalledWith(expect.arrayContaining([
            { clientId: 'A', leadDate: '2026-10-01' },
            { clientId: 'B', leadDate: '2026-10-02' },
            { clientId: 'C', leadDate: '2026-10-03' },
        ]));
        expect(body.totalAppointmentsBooked).toBe(2);
        expect(body.totalAppointmentsCompleted).toBe(1);
        const byId = Object.fromEntries(body.campaignBreakdown.map((c: { id: string }) => [c.id, c]));
        expect(byId.c1).toMatchObject({ appointmentsBooked: 2, appointmentsCompleted: 1 });
        expect(byId.c2).toMatchObject({ appointmentsBooked: 0, appointmentsCompleted: 0 });
    });

    it('says the match is email-only, so it reads as different from Lead Sources', async () => {
        h.leads.mockResolvedValue({ leads: [], byCampaign: new Map(), totalLeads: 5, hasLeadForms: true });
        const res = await GET(new NextRequest('http://x/api/paid-ads/roas?since=2026-09-20&until=2026-10-19'));
        expect((await res.json()).attributionNote).toMatch(/Lead Sources.*phone/);
    });
});
