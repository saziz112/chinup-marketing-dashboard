import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({ competitors: vi.fn(), rows: [] as Record<string, unknown>[] }));
vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { email: 'x@y.com' } }) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/db/sql', () => ({ sql: async () => ({ rows: h.rows }) }));
vi.mock('@/lib/integrations/meta-organic', () => ({ getIGCompetitorMetrics: h.competitors }));
vi.mock('../trends/route', () => ({ SERVICE_KEYWORDS: [] }));

import { GET } from './route';

describe('GET /api/research/competitor-watch', () => {
    beforeEach(() => { h.competitors.mockReset(); vi.spyOn(console, 'error').mockImplementation(() => {}); });

    it('returns an error instead of "0 competitors tracked" when the lookup fails', async () => {
        h.competitors.mockRejectedValue(new Error('every Business Discovery lookup failed'));
        const res = await GET(new NextRequest('http://x/api/research/competitor-watch?location=all'));
        expect(res.status).toBe(500);
        expect((await res.json()).error).toMatch(/Business Discovery/);
    });

    it('does not compare our engagement to competitors, because the two use different formulas', async () => {
        // Ours is interactions ÷ views; Business Discovery only allows likes+comments ÷ followers.
        h.rows = [{ avg_eng: 0.5 }];
        h.competitors.mockResolvedValue([{ username: 'rival', followersCount: 1000, avgEngagementRate: 0.002 }]);
        const body = await (await GET(new NextRequest('http://x/api/research/competitor-watch?location=all'))).json();
        expect(body.summary.engagementDiff).toBeUndefined();
        expect(body.summary.ourAvgEngagement).toBeUndefined();
        expect(body.summary.competitorAvgEngagement).toBeCloseTo(0.002);
    });
});
