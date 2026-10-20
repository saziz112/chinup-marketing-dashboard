import { describe, it, expect } from 'vitest';
import { median, rankOutliers, type OutlierInput } from './outlier';

describe('median', () => {
    it('returns null for an empty list', () => {
        expect(median([])).toBeNull();
    });
    it('takes the middle value of an odd list, unsorted input', () => {
        expect(median([9, 1, 5])).toBe(5);
    });
    it('averages the two middle values of an even list', () => {
        expect(median([1, 2, 3, 10])).toBe(2.5);
    });
});

function vids(accountId: number, views: number[]): OutlierInput[] {
    return views.map((v, i) => ({ id: accountId * 1000 + i, accountId, views: v }));
}

describe('rankOutliers', () => {
    it('scores each video against its own account median, not a global one', () => {
        // Big account: median 100K. Small account: median 1K.
        const big = vids(1, [90_000, 100_000, 110_000, 100_000, 300_000]);
        const small = vids(2, [900, 1_000, 1_100, 1_000, 20_000]);
        const ranked = rankOutliers([...big, ...small]);
        // Small account's 20K video is 20x its median; big account's 300K is 3x.
        expect(ranked[0]).toMatchObject({ id: 2004, score: 20, accountMedian: 1000 });
        expect(ranked[1]).toMatchObject({ id: 1004, score: 3, accountMedian: 100_000 });
    });

    it('leaves accounts with too few videos unscored (median not trustworthy)', () => {
        const ranked = rankOutliers([...vids(1, [10, 20, 5000]), ...vids(2, [100, 100, 100, 100, 400])]);
        expect(ranked.map(r => r.accountId)).toEqual([2, 2, 2, 2, 2]);
    });

    it('respects a custom minimum sample size', () => {
        const ranked = rankOutliers(vids(1, [10, 20, 5000]), { minVideosPerAccount: 3 });
        expect(ranked[0]).toMatchObject({ id: 1002, score: 250 });
    });

    it('skips accounts whose median is zero instead of dividing by zero', () => {
        expect(rankOutliers(vids(1, [0, 0, 0, 0, 0, 50]))).toEqual([]);
    });

    it('ignores videos with no view count when computing the median', () => {
        const input: OutlierInput[] = [...vids(1, [100, 100, 100, 100, 100]), { id: 9, accountId: 1, views: null }];
        const ranked = rankOutliers(input);
        expect(ranked).toHaveLength(5);
        expect(ranked.every(r => r.score === 1)).toBe(true);
    });

    it('reports where each video sits within its own account (top 1% check)', () => {
        const views = Array.from({ length: 100 }, (_, i) => 1000 + i); // 1000..1099
        views[37] = 500_000; // one viral post
        const ranked = rankOutliers(vids(1, views));
        expect(ranked[0].id).toBe(1037);
        expect(ranked[0].rankInAccount).toBe(1);
        expect(ranked[0].accountVideoCount).toBe(100);
        expect(ranked[0].percentileInAccount).toBeLessThanOrEqual(0.01);
    });

    it('rounds scores to one decimal for display', () => {
        const ranked = rankOutliers(vids(1, [3, 3, 3, 3, 10]));
        expect(ranked[0].score).toBe(3.3);
    });
});
