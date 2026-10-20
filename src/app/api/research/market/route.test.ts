import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({ report: vi.fn() }));
vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { email: 'x@y.com' } }) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/db/sql', () => ({ sql: async () => ({ rows: [] }) }));
vi.mock('@/lib/lead-sources', () => ({ getLeadSourceReport: h.report }));

import { GET } from './route';

describe('GET /api/research/market', () => {
    it('ranks lead sources by the same channels as the Lead Sources page, last 90 days', async () => {
        h.report.mockResolvedValue({
            rows: [
                { channel: 'Website', leads: 40 },
                { channel: 'Paid Social', leads: 120 },
                { channel: 'Unattributed', leads: 15 },
            ],
        });
        const body = await (await GET(new NextRequest('http://x/api/research/market'))).json();
        expect(h.report).toHaveBeenCalledWith({ minAgeDays: 0, maxAgeDays: 90 });
        expect(body.topSources.map((s: { source: string; count: number }) => [s.source, s.count])).toEqual([
            ['Paid Social', 120],
            ['Website', 40],
            ['Unattributed', 15],
        ]);
    });
});
