import { describe, it, expect } from 'vitest';
import { generateAllPlatformsInsights } from './all-platforms-insights';

const fb = (engagementRate: number) => ({ configured: true, engagementRate, followers: 2455, followerChangePercent: 0, videoViews: 50 });

describe('generateAllPlatformsInsights', () => {
    it('does not let FB engagements ÷ video views feed a score graded on reach-based benchmarks', () => {
        const high = generateAllPlatformsInsights({ ig: null, fb: fb(11.96), yt: null });
        const low = generateAllPlatformsInsights({ ig: null, fb: fb(0.1), yt: null });
        expect(high.healthByPlatform[0].score).toBe(low.healthByPlatform[0].score);
    });

    it('labels each platform ER with its own formula, including in the focus text', () => {
        const res = generateAllPlatformsInsights({
            ig: null,
            fb: { configured: true, engagementRate: 11.96, followers: 2455, followerChangePercent: 2, videoViews: 5000 },
            yt: { configured: true, engagementRate: 0.38, subscribers: 100, videosInPeriod: 0, avgViewsPerVideo: 0 },
        });
        const formula = Object.fromEntries(res.healthByPlatform.map(h => [h.key, h.engagementRateFormula]));
        expect(formula).toEqual({
            facebook: 'engagements ÷ video views',
            youtube: '(likes + comments) ÷ views',
        });
        expect(res.whereToFocus?.title).toBe('Double down on Facebook');
        expect(res.whereToFocus?.body).toContain('11.96% engagements ÷ video views');
    });
});
