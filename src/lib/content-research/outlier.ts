/**
 * Outlier score: a video's views ÷ the median views of the account that posted it.
 * A 10x on a 2K-view account beats a 2x on a 2M-view account, because it shows
 * the idea worked, not the follower count.
 */

export interface OutlierInput {
    id: number;
    accountId: number;
    views: number | null;
}

export interface OutlierResult {
    id: number;
    accountId: number;
    views: number;
    accountMedian: number;
    /** views ÷ accountMedian, one decimal */
    score: number;
    /** 1 = this account's most-viewed video in the sample */
    rankInAccount: number;
    accountVideoCount: number;
    /** rankInAccount ÷ accountVideoCount; 0.01 = top 1% of the account */
    percentileInAccount: number;
}

/** Below this many videos an account's median swings too much to trust. */
export const MIN_VIDEOS_PER_ACCOUNT = 5;

export function median(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function rankOutliers(
    videos: OutlierInput[],
    opts: { minVideosPerAccount?: number } = {},
): OutlierResult[] {
    const minVideos = opts.minVideosPerAccount ?? MIN_VIDEOS_PER_ACCOUNT;

    const byAccount = new Map<number, { id: number; views: number }[]>();
    for (const v of videos) {
        if (v.views === null || !Number.isFinite(v.views)) continue;
        const list = byAccount.get(v.accountId) ?? [];
        list.push({ id: v.id, views: v.views });
        byAccount.set(v.accountId, list);
    }

    const results: OutlierResult[] = [];
    for (const [accountId, list] of byAccount) {
        if (list.length < minVideos) continue;
        const accountMedian = median(list.map(v => v.views));
        if (!accountMedian) continue;
        const byViews = [...list].sort((a, b) => b.views - a.views);
        byViews.forEach((v, i) => {
            results.push({
                id: v.id,
                accountId,
                views: v.views,
                accountMedian,
                score: Math.round((v.views / accountMedian) * 10) / 10,
                rankInAccount: i + 1,
                accountVideoCount: list.length,
                percentileInAccount: (i + 1) / list.length,
            });
        });
    }

    return results.sort((a, b) => b.score - a.score || b.views - a.views);
}
