import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/db/sql', () => ({ sql: h.query }));

import { getLeadSourceReport } from './lead-sources';

// One row per PERSON, as the deduped query returns them. location_key is the
// person's single assigned location (first touch), so every person belongs to
// exactly one location.
function person(
    id: string,
    location_key: string,
    o: { purchased?: boolean; revenue?: number; prior?: boolean } = {},
) {
    return {
        contact_id: id,
        location_key,
        source: 'Facebook Lead Form',
        attribution_source: null,
        attribution_synced_at: new Date('2026-09-01T00:00:00Z'),
        tags: [],
        created_at: new Date('2026-08-10T12:00:00Z'),
        had_prior_purchase: o.prior ?? false,
        purchased: o.purchased ?? false,
        revenue: String(o.revenue ?? 0),
        revenue_to_date: String(o.revenue ?? 0),
        contactable: true,
    };
}

const PEOPLE = [
    person('a', 'decatur', { purchased: true, revenue: 500 }),
    person('b', 'decatur'),
    person('c', 'kennesaw', { purchased: true, revenue: 1200 }),
    person('d', 'smyrna', { prior: true, revenue: 300 }),
    person('e', 'smyrna', { purchased: true, revenue: 80 }),
    person('f', 'smyrna'),
];

describe('getLeadSourceReport location filter', () => {
    beforeEach(() => {
        h.query.mockReset().mockResolvedValue({ rows: PEOPLE });
    });

    it('dedupes people before filtering, so the location never reaches the query', async () => {
        await getLeadSourceReport({ from: '2026-08-01', to: '2026-09-01', location: 'decatur' });
        const values = h.query.mock.calls[0].slice(1);
        expect(values).not.toContain('decatur');
    });

    it('per-location totals sum to All and never exceed it', async () => {
        const opts = { from: '2026-08-01', to: '2026-09-01' };
        const all = await getLeadSourceReport({ ...opts, location: null });
        const parts = await Promise.all(
            ['decatur', 'kennesaw', 'smyrna'].map((location) =>
                getLeadSourceReport({ ...opts, location }),
            ),
        );
        for (const key of ['leads', 'newLeads', 'purchased', 'revenue', 'revenueToDate'] as const) {
            const sum = parts.reduce((n, p) => n + p.totals[key], 0);
            expect(sum).toBeLessThanOrEqual(all.totals[key]);
            expect(sum).toBe(all.totals[key]);
        }
        expect(all.totals).toMatchObject({ leads: 6, newLeads: 5, purchased: 3, revenue: 1780 });
        expect(parts.map((p) => p.totals.leads)).toEqual([2, 1, 3]);
    });
});
