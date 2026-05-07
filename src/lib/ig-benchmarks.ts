/**
 * Instagram Organic Benchmarks for Med Spa / Aesthetics Industry (2026)
 *
 * Sources: Sprout Social 2026 Metrics, Rival IQ Health & Beauty, Hootsuite
 * Social Media Benchmarks 2026, Buffer IG Algorithm 2026, TrueFuture Media
 * IG Reach 2026, Cufinder Follower Growth Rate Benchmarks.
 *
 * "good" = top quartile / strong performance
 * "average" = median / industry baseline
 * Below "average" = "poor"
 */

export type BenchmarkGrade = 'good' | 'average' | 'poor';

export interface MetricGrade {
    grade: BenchmarkGrade;
    value: number;
    label: string;
    color: string;
}

interface Thresholds {
    good: number;
    average: number;
    /** If true, lower values are better (e.g., reply hours) */
    inverted?: boolean;
}

export const IG_ORGANIC_BENCHMARKS: Record<string, Thresholds> = {
    feedPostsPerWeek:      { good: 4,    average: 2 },
    reelsPerWeek:          { good: 4,    average: 2 },
    storiesPerDay:         { good: 3,    average: 1 },
    carouselMixPercent:    { good: 30,   average: 15 },   // % of feed posts that are carousels
    engagementRate:        { good: 2.0,  average: 1.0 },  // % — interactions/reach
    saveRate:              { good: 1.0,  average: 0.3 },  // % — saves/reach
    sendRate:              { good: 0.5,  average: 0.1 },  // % — shares/reach
    monthlyFollowerGrowth: { good: 3.0,  average: 1.0 },  // % monthly net growth
    commentReplyRate:      { good: 80,   average: 50 },   // % of comments replied to
    avgReplyHours:         { good: 2,    average: 12, inverted: true },
};

const GRADE_CONFIG: Record<BenchmarkGrade, { label: string; color: string }> = {
    good:    { label: 'On Target', color: '#22c55e' },
    average: { label: 'Average',   color: '#f59e0b' },
    poor:    { label: 'Off Target', color: '#ef4444' },
};

/**
 * Grade a single IG organic metric against industry benchmarks.
 */
export function gradeIGMetric(
    metric: string,
    value: number | null | undefined,
): MetricGrade | null {
    if (value === null || value === undefined) return null;

    const t = IG_ORGANIC_BENCHMARKS[metric];
    if (!t) return null;

    let grade: BenchmarkGrade;
    if (t.inverted) {
        if (value <= t.good) grade = 'good';
        else if (value <= t.average) grade = 'average';
        else grade = 'poor';
    } else {
        if (value >= t.good) grade = 'good';
        else if (value >= t.average) grade = 'average';
        else grade = 'poor';
    }

    const cfg = GRADE_CONFIG[grade];
    return { grade, value, label: cfg.label, color: cfg.color };
}

/**
 * Coaching nudge structure — surfaced when a metric falls below benchmark.
 */
export interface CoachingNudge {
    metric: string;
    severity: 'critical' | 'warning' | 'info';
    title: string;
    body: string;
}

/**
 * Generate coaching nudges from current metric values + deltas.
 * Returns nudges sorted by severity (critical first), capped at top 2.
 */
export function generateNudges(input: {
    reelsPerWeek: number;
    feedPostsPerWeek: number;
    carouselMixPercent: number;
    storiesActive?: number;
    saveRate: number;
    sendRate: number;
    replyRate?: number;
    avgReplyHours?: number | null;
    totalComments?: number;
    saveRateDeltaPct?: number;
    sendRateDeltaPct?: number;
    engagementRateDeltaPct?: number;
}): CoachingNudge[] {
    const nudges: CoachingNudge[] = [];

    if (input.reelsPerWeek < 3) {
        nudges.push({
            metric: 'reelsPerWeek',
            severity: input.reelsPerWeek < 2 ? 'critical' : 'warning',
            title: `Reels cadence is ${input.reelsPerWeek}/week`,
            body: 'Posting fewer than 3 Reels/week causes the algorithm to deprioritize you in discovery feeds. Add 1–2 more this week.',
        });
    }

    if (input.storiesActive !== undefined && input.storiesActive === 0) {
        nudges.push({
            metric: 'storiesActive',
            severity: 'warning',
            title: 'No active Stories today',
            body: 'Stories drive 3–5x higher CTR than bio links and keep you in followers\' top-of-feed bar. Post at least 1 today (treatment teaser, BTS, poll).',
        });
    }

    if (input.carouselMixPercent < 15) {
        nudges.push({
            metric: 'carouselMixPercent',
            severity: input.carouselMixPercent < 5 ? 'warning' : 'info',
            title: `Carousels are ${Math.round(input.carouselMixPercent)}% of your feed mix`,
            body: 'Carousels have the highest engagement rate of any IG format in 2026 (~1.92% avg). Try 1 carousel this week — adding music pushes it into the Reels feed too.',
        });
    }

    if ((input.saveRateDeltaPct ?? 0) <= -25) {
        nudges.push({
            metric: 'saveRate',
            severity: 'warning',
            title: `Save rate dropped ${Math.abs(Math.round(input.saveRateDeltaPct!))}% vs prior period`,
            body: 'Saves are one of the strongest 2026 algorithm signals. Try save-driving CTAs like "Save this for your consult" or "Bookmark for next visit".',
        });
    }

    if ((input.sendRateDeltaPct ?? 0) <= -25) {
        nudges.push({
            metric: 'sendRate',
            severity: 'warning',
            title: `Sends dropped ${Math.abs(Math.round(input.sendRateDeltaPct!))}% vs prior period`,
            body: 'Sends (DM shares) are the strongest sharability signal. Make content people want to share with a friend — relatable myths, BA reveals, treatment comparisons.',
        });
    }

    if ((input.engagementRateDeltaPct ?? 0) <= -30) {
        nudges.push({
            metric: 'engagementRate',
            severity: 'critical',
            title: `Engagement rate down ${Math.abs(Math.round(input.engagementRateDeltaPct!))}%`,
            body: 'A sustained ER drop signals content fatigue. Review your top-performing format from last 30d and double down. Avoid "tag a friend" CTAs — they trigger demotion in 2026.',
        });
    }

    if (input.totalComments !== undefined && input.totalComments >= 5 && input.replyRate !== undefined && input.replyRate < 50) {
        nudges.push({
            metric: 'commentReplyRate',
            severity: input.replyRate < 25 ? 'critical' : 'warning',
            title: `Reply rate is ${Math.round(input.replyRate)}%`,
            body: 'Replying to comments boosts post velocity in the algorithm and shows followers they\'re seen. Aim for 80%+, ideally within an hour.',
        });
    }

    if (input.avgReplyHours != null && input.avgReplyHours > 12 && input.totalComments !== undefined && input.totalComments >= 5) {
        nudges.push({
            metric: 'avgReplyHours',
            severity: input.avgReplyHours > 24 ? 'warning' : 'info',
            title: `Slow reply time — avg ${Math.round(input.avgReplyHours)}h`,
            body: 'Comments that get replies in the first hour drive 2–3x more engagement on the post. Set a daily reply window if dedicated replies aren\'t happening.',
        });
    }

    // Sort by severity: critical → warning → info
    const order: Record<string, number> = { critical: 0, warning: 1, info: 2 };
    nudges.sort((a, b) => order[a.severity] - order[b.severity]);

    return nudges.slice(0, 2);
}
