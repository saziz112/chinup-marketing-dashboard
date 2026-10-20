import { it, expect } from 'vitest';
import { generateFBCoachingPlan } from './fb-coaching';

it('does not compare a per-video-view ER to the medspa per-reach average', () => {
    const plan = generateFBCoachingPlan({ totalVideoViews: 1000, totalEngagements: 120, totalPageViews: 300, engagementRate: 12, followerChange: 5, followerChangePercent: 0.2, days: 30 });
    expect(JSON.stringify(plan)).not.toMatch(/0\.2.0\.5%/);
});
