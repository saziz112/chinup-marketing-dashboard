import { it, expect } from 'vitest';
import { buildPrompt } from './fb-coaching-ai';

it('does not grade engagements ÷ video views against a reach-based medspa benchmark', () => {
    const prompt = buildPrompt({
        period: '30d', pageName: 'Chin Up',
        metrics: { followers: 2455, followerChange: 5, followerChangePercent: 0.2, totalVideoViews: 1000, totalEngagements: 120, totalPageViews: 300, engagementRate: 12 },
    });
    expect(prompt).not.toContain('0.2-0.5%');
    expect(prompt).toContain('engagements ÷ video views');
});
