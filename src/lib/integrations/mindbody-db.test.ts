import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/db/sql', () => ({ sql: h.query }));

import { getAppointmentsByClientIds } from './mindbody-db';

describe('getAppointmentsByClientIds', () => {
    beforeEach(() => {
        h.query.mockReset().mockResolvedValue({ rows: [] });
    });

    it('counts from each client\'s earliest lead date and skips cancellations', async () => {
        await getAppointmentsByClientIds([
            { clientId: 'A', leadDate: '2026-10-05' },
            { clientId: 'A', leadDate: '2026-10-01' },
            { clientId: 'B', leadDate: '2026-10-03' },
        ]);
        expect(h.query).toHaveBeenCalledTimes(1);
        const [strings, ...values] = h.query.mock.calls[0];
        const text = (strings as string[]).join('?');
        expect(values).toContainEqual(['A', 'B']);
        expect(values).toContainEqual(['2026-10-01', '2026-10-03']);
        expect(text).toMatch(/start_date::date >= p\.lead_date/);
        expect(text).toMatch(/NOT ILIKE '%cancel%'/);
        // '\D' in a template literal cooks to 'D' and strips the letter, not
        // non-digits; the query must carry a real backslash.
        expect(text).toContain("'\\D'");
    });

    it('tallies booked, completed and no-show per client', async () => {
        h.query.mockResolvedValue({
            rows: [
                { client_id: 'A', status: 'Completed', cnt: 2 },
                { client_id: 'A', status: 'NoShow', cnt: 1 },
                { client_id: 'B', status: 'Booked', cnt: 1 },
            ],
        });
        const map = await getAppointmentsByClientIds([
            { clientId: 'A', leadDate: '2026-10-01' },
            { clientId: 'B', leadDate: '2026-10-01' },
        ]);
        expect(map.get('A')).toEqual({ booked: 3, completed: 2, noShow: 1 });
        expect(map.get('B')).toEqual({ booked: 1, completed: 0, noShow: 0 });
    });
});
