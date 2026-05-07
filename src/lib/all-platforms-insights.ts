/**
 * Cross-Platform Insights for the "All Platforms" overview tab.
 *
 * Compares IG / FB / YT health against per-platform benchmarks and produces:
 *   - bestPlatform: the strongest channel (highest health score)
 *   - mostActivePlatform: where the most output is happening
 *   - whereToFocus: rule-based recommendation of where to invest more attention
 */

import { gradeIGMetric, type MetricGrade } from './ig-benchmarks';

export type PlatformKey = 'instagram' | 'facebook' | 'youtube';

export interface PlatformHealth {
    key: PlatformKey;
    label: string;
    color: string;        // platform brand color
    score: number;        // 0-100 composite health score
    grade: MetricGrade;   // good/average/poor with color
    primaryEngagementRate: number;
}

export interface FocusRecommendation {
    title: string;        // e.g. "Double down on Instagram"
    body: string;         // 1-2 sentence reasoning
    suggestedAction: string; // concrete next move
    targetPlatform: PlatformKey;
}

export interface AllPlatformsInsights {
    healthByPlatform: PlatformHealth[];
    bestPlatform: PlatformHealth | null;
    mostActivePlatform: { key: PlatformKey; label: string; activityCount: number; activityLabel: string } | null;
    whereToFocus: FocusRecommendation | null;
}

interface InsightInput {
    ig: {
        configured: boolean;
        engagementRate: number;
        followers: number;
        followerChangePercent: number;
        reelsPerWeek: number;
        feedPostsPerWeek: number;
    } | null;
    fb: {
        configured: boolean;
        engagementRate: number;
        followers: number;
        followerChangePercent: number;
        videoViews: number;
    } | null;
    yt: {
        configured: boolean;
        engagementRate: number;
        subscribers: number;
        videosInPeriod: number;
        avgViewsPerVideo: number;
    } | null;
}

const PLATFORM_META: Record<PlatformKey, { label: string; color: string }> = {
    instagram: { label: 'Instagram', color: '#E1306C' },
    facebook:  { label: 'Facebook',  color: '#1877F2' },
    youtube:   { label: 'YouTube',   color: '#FF0000' },
};

// Composite score per platform: weighted blend of ER vs benchmark + cadence/activity vs benchmark
// Returns 0-100. Anchored so good=100, average=60, poor=20 (mirrors ads-benchmarks)
function scoreIG(ig: NonNullable<InsightInput['ig']>): number {
    // ER weighted 50%, Reels cadence 30%, follower growth 20%
    const er = gradeIGMetric('engagementRate', ig.engagementRate);
    const reels = gradeIGMetric('reelsPerWeek', ig.reelsPerWeek);
    const growth = gradeIGMetric('monthlyFollowerGrowth', ig.followerChangePercent);
    const grades = [
        { g: er, w: 50 }, { g: reels, w: 30 }, { g: growth, w: 20 },
    ];
    return scoreFromGrades(grades);
}

function scoreFB(fb: NonNullable<InsightInput['fb']>): number {
    // FB has fewer benchmarks — treat ER+follower growth+video views as the signal
    let totalScore = 0;
    let totalWeight = 0;
    // ER: medspa FB avg 0.2-0.5%, good 1%+
    const erScore = fb.engagementRate >= 1.0 ? 100 : fb.engagementRate >= 0.5 ? 60 : fb.engagementRate >= 0.1 ? 30 : 10;
    totalScore += erScore * 50; totalWeight += 50;
    // Follower growth
    const growthScore = fb.followerChangePercent >= 1.0 ? 100 : fb.followerChangePercent >= 0.3 ? 60 : fb.followerChangePercent > 0 ? 30 : 10;
    totalScore += growthScore * 25; totalWeight += 25;
    // Video views (above 500/period = active)
    const viewScore = fb.videoViews >= 2000 ? 100 : fb.videoViews >= 500 ? 60 : fb.videoViews >= 100 ? 30 : 10;
    totalScore += viewScore * 25; totalWeight += 25;
    return totalScore / totalWeight;
}

function scoreYT(yt: NonNullable<InsightInput['yt']>): number {
    // ER + cadence + reach (avg views per video)
    let totalScore = 0;
    let totalWeight = 0;
    // ER: YT good 4%+
    const erScore = yt.engagementRate >= 4.0 ? 100 : yt.engagementRate >= 2.0 ? 60 : yt.engagementRate >= 1.0 ? 30 : 10;
    totalScore += erScore * 40; totalWeight += 40;
    // Cadence (videos in period)
    const cadenceScore = yt.videosInPeriod >= 8 ? 100 : yt.videosInPeriod >= 4 ? 60 : yt.videosInPeriod >= 1 ? 30 : 10;
    totalScore += cadenceScore * 30; totalWeight += 30;
    // Avg views per video relative to subs
    const reachRatio = yt.subscribers > 0 ? yt.avgViewsPerVideo / yt.subscribers : 0;
    const reachScore = reachRatio >= 0.2 ? 100 : reachRatio >= 0.05 ? 60 : reachRatio > 0 ? 30 : 10;
    totalScore += reachScore * 30; totalWeight += 30;
    return totalScore / totalWeight;
}

function scoreFromGrades(grades: Array<{ g: MetricGrade | null; w: number }>): number {
    let totalScore = 0;
    let totalWeight = 0;
    const map: Record<string, number> = { good: 100, average: 60, poor: 20 };
    for (const { g, w } of grades) {
        if (!g) continue;
        totalScore += (map[g.grade] || 0) * w;
        totalWeight += w;
    }
    return totalWeight > 0 ? totalScore / totalWeight : 0;
}

function scoreToGrade(score: number): MetricGrade {
    if (score >= 75) return { grade: 'good',    value: score, label: 'On Target',  color: '#22c55e' };
    if (score >= 50) return { grade: 'average', value: score, label: 'Average',    color: '#f59e0b' };
    return                  { grade: 'poor',    value: score, label: 'Off Target', color: '#ef4444' };
}

export function generateAllPlatformsInsights(input: InsightInput): AllPlatformsInsights {
    const healths: PlatformHealth[] = [];

    if (input.ig?.configured) {
        const score = scoreIG(input.ig);
        healths.push({
            key: 'instagram', label: PLATFORM_META.instagram.label, color: PLATFORM_META.instagram.color,
            score, grade: scoreToGrade(score), primaryEngagementRate: input.ig.engagementRate,
        });
    }
    if (input.fb?.configured) {
        const score = scoreFB(input.fb);
        healths.push({
            key: 'facebook', label: PLATFORM_META.facebook.label, color: PLATFORM_META.facebook.color,
            score, grade: scoreToGrade(score), primaryEngagementRate: input.fb.engagementRate,
        });
    }
    if (input.yt?.configured) {
        const score = scoreYT(input.yt);
        healths.push({
            key: 'youtube', label: PLATFORM_META.youtube.label, color: PLATFORM_META.youtube.color,
            score, grade: scoreToGrade(score), primaryEngagementRate: input.yt.engagementRate,
        });
    }

    const bestPlatform = healths.length > 0
        ? [...healths].sort((a, b) => b.score - a.score)[0]
        : null;

    // Most active = who's putting out the most output right now
    const activity: Array<{ key: PlatformKey; label: string; activityCount: number; activityLabel: string }> = [];
    if (input.ig?.configured) {
        activity.push({
            key: 'instagram', label: 'Instagram',
            activityCount: input.ig.feedPostsPerWeek,
            activityLabel: `${input.ig.feedPostsPerWeek} posts/wk`,
        });
    }
    if (input.yt?.configured) {
        const perWeek = input.yt.videosInPeriod / 4; // approx — period-agnostic for label
        activity.push({
            key: 'youtube', label: 'YouTube',
            activityCount: perWeek,
            activityLabel: `${input.yt.videosInPeriod} videos`,
        });
    }
    // FB: we don't track FB cadence (no post-level data) — exclude from "most active"
    const mostActivePlatform = activity.length > 0
        ? [...activity].sort((a, b) => b.activityCount - a.activityCount)[0]
        : null;

    // Where to focus: pick the platform with the BIGGEST gap between effort and outcome
    const whereToFocus = computeWhereToFocus(input, healths);

    return { healthByPlatform: healths, bestPlatform, mostActivePlatform, whereToFocus };
}

function computeWhereToFocus(input: InsightInput, healths: PlatformHealth[]): FocusRecommendation | null {
    if (healths.length === 0) return null;

    // Strategy:
    //  1. If any platform is severely underperforming (score < 40) → focus there
    //  2. If a platform is strong (score >= 75) but cadence is high → "ride the wave"
    //  3. Default → focus on the lowest-score platform

    const sorted = [...healths].sort((a, b) => a.score - b.score);
    const weakest = sorted[0];
    const strongest = sorted[sorted.length - 1];

    // Special: cross-posting opportunity (IG strong, YT weak)
    if (
        input.ig?.configured && input.yt?.configured &&
        healths.find(h => h.key === 'instagram')!.score >= 60 &&
        healths.find(h => h.key === 'youtube')!.score < 50
    ) {
        return {
            title: 'Cross-post your Instagram to YouTube',
            body: 'Instagram is performing well, but very little of it is making it to YouTube. Cross-posting Reels as YT Shorts is the highest-leverage move you can make right now.',
            suggestedAction: 'For the next 5 IG Reels you post, also upload them to YouTube Shorts within 24h. ~5 min per Reel.',
            targetPlatform: 'youtube',
        };
    }

    // FB underutilized
    if (
        input.fb?.configured && healths.find(h => h.key === 'facebook')!.score < 50 &&
        healths.find(h => h.key === 'instagram')?.score && healths.find(h => h.key === 'instagram')!.score >= 50
    ) {
        return {
            title: 'Activate Facebook by mirroring Instagram',
            body: 'Your IG is healthy but FB is dormant. FB Page audience skews older and higher-LTV — turn on auto-cross-posting in Meta Business Suite for free reach.',
            suggestedAction: 'Meta Business Suite → Settings → Connected Accounts → toggle "Auto-share IG to Facebook." 5 min setup, ongoing leverage.',
            targetPlatform: 'facebook',
        };
    }

    // Strong platform: ride the wave
    if (strongest.score >= 75) {
        return {
            title: `Double down on ${strongest.label}`,
            body: `${strongest.label} is your strongest channel right now (${Math.round(strongest.score)}/100 health score, ${strongest.primaryEngagementRate}% ER). When something is working, do more of it.`,
            suggestedAction: `Increase your ${strongest.label} cadence by 25% this week. Replicate the format/style of your top-performing post from the last 30 days.`,
            targetPlatform: strongest.key,
        };
    }

    // Weakest platform fix
    return {
        title: `Address ${weakest.label} first`,
        body: `${weakest.label} health is at ${Math.round(weakest.score)}/100. Fixing the weakest channel raises overall performance more than optimizing the strongest.`,
        suggestedAction: `Open the ${weakest.label} tab and follow this week's top coaching action.`,
        targetPlatform: weakest.key,
    };
}
