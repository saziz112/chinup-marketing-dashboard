import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({ coach: vi.fn() }));
vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { email: 'x@y.com' } }) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/ig-coaching-ai', () => ({ generateAICoachingPlan: h.coach }));
const totals = { reach: 500, views: 0, totalInteractions: 0, accountsEngaged: 0, profileViews: 0, websiteClicks: 0, saves: 0, shares: 0, likes: 0, comments: 0 };
vi.mock('@/lib/integrations/meta-organic', () => ({
    isMetaConfigured: () => true,
    clearMetaCache: () => {},
    getIGProfile: async () => ({ username: 'chinupaesthetics', followersCount: 1000, mediaCount: 10 }),
    getIGInsights: async () => ({ daily: [], totals }),
    getIGPeriodTotals: async () => ({ totalReach: 400, totals }),
    getIGMedia: async () => [],
    getIGStories: async () => [],
}));

import { GET } from './route';

describe('GET /api/organic/instagram', () => {
    beforeEach(() => { h.coach.mockReset().mockResolvedValue({ summary: 'plan' }); });

    it('builds the AI coaching plan by default', async () => {
        const body = await (await GET(new NextRequest('http://x/api/organic/instagram?period=30d'))).json();
        expect(h.coach).toHaveBeenCalledTimes(1);
        expect(body.aiCoachingPlan).toEqual({ summary: 'plan' });
    });

    it('skips the slow AI coaching call when the caller only needs the numbers', async () => {
        const body = await (await GET(new NextRequest('http://x/api/organic/instagram?period=30d&coaching=0'))).json();
        expect(h.coach).not.toHaveBeenCalled();
        expect(body.configured).toBe(true);
        expect(body.summary.followers).toBe(1000);
        expect(body.aiCoachingPlan).toBeNull();
    });
});
