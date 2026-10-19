/**
 * Instagram post engagement rate: interactions ÷ max(views, reach).
 *
 * Null when Instagram returned neither views nor reach (insights call failed or
 * not yet available). The old code divided by 1 in that case, so a post with
 * 52 likes stored as 5,200% and wrecked every average built on it.
 */
export function postEngagementRate(p: {
    likes: number; comments: number; shares: number; saves: number; views: number; reach: number;
}): number | null {
    const denominator = Math.max(p.views, p.reach);
    if (denominator <= 0) return null;
    return (p.likes + p.comments + p.shares + p.saves) / denominator;
}

export function averageRate(rates: (number | null)[]): number | null {
    const known = rates.filter((r): r is number => r !== null);
    return known.length > 0 ? known.reduce((a, b) => a + b, 0) / known.length : null;
}
