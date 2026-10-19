import { describe, it, expect } from 'vitest';
import { postEngagementRate, averageRate } from './engagement';

describe('postEngagementRate', () => {
    it('divides interactions by the larger of views and reach', () => {
        expect(postEngagementRate({ likes: 30, comments: 5, shares: 3, saves: 2, views: 800, reach: 400 })).toBe(0.05);
    });

    it('returns null instead of interactions ÷ 1 when Instagram gave no views or reach', () => {
        expect(postEngagementRate({ likes: 52, comments: 8, shares: 0, saves: 0, views: 0, reach: 0 })).toBeNull();
    });
});

describe('averageRate', () => {
    it('averages only posts that have a rate, and is null when none do', () => {
        expect(averageRate([0.1, null, 0.3])).toBeCloseTo(0.2);
        expect(averageRate([null, null])).toBeNull();
    });
});
