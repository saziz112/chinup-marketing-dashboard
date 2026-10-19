import { describe, it, expect, vi } from 'vitest';

const post = (caption: string, likes: number, views: number, reach = 0) =>
    ({ caption, platform: 'instagram', post_type: 'IMAGE', permalink: `https://x/${caption}`, likes, comments: 0, shares: 0, saves: 0, views, reach, engagement_rate: null, posted_at: '2026-10-01' });

vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { email: 'x@y.com' } }) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/db/sql', () => ({
    sql: async () => ({
        rows: [
            post('Our team BTS day', 52, 0),          // lifestyle, no insights
            post('Book now, 20% off this week', 10, 200), // promotional, 5%
            post('Spring special: book today', 30, 0, 300), // promotional, reach only, 10%
        ],
    }),
}));

import { GET } from './route';

describe('GET /api/research/content-analysis', () => {
    it('computes engagement only from posts with views or reach, never interactions ÷ 1', async () => {
        const body = await (await GET()).json();
        expect(body.overallAvgEngagement).toBeCloseTo(0.075);
        const promo = body.categories.find((c: { category: string }) => c.category === 'promotional');
        expect(promo.avgEngagement).toBeCloseTo(0.075);
        const lifestyle = body.categories.find((c: { category: string }) => c.category === 'lifestyle');
        expect(lifestyle.avgEngagement).toBeNull();
        expect(lifestyle.postCount).toBe(1);
    });
});
