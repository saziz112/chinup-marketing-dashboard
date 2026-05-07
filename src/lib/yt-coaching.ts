/**
 * YouTube Coaching (rule-based)
 *
 * YT data: subscribers, recent video views/likes/comments, ER, avg views per video,
 * shorts vs long-form mix, individual videos with isShort flag.
 *
 * Coaching focuses on cadence, format mix (Shorts vs Long), avg views growth, ER.
 */

import type { CoachingPlan, CoachingStrength, FocusAction, NextSkill } from './ig-coaching';

interface YTCoachingInput {
    videosInPeriod: number;
    days: number;
    shortsCount: number;
    longFormCount: number;
    engagementRate: number;
    avgViewsPerVideo: number;
    recentVideoViews: number;
    subscribers: number;
}

function ytStrengths(m: YTCoachingInput): CoachingStrength[] {
    const out: CoachingStrength[] = [];
    const videosPerWeek = (m.videosInPeriod / m.days) * 7;
    const shortsRatio = m.videosInPeriod > 0 ? m.shortsCount / m.videosInPeriod : 0;

    if (videosPerWeek >= 2) {
        out.push({
            label: `${videosPerWeek.toFixed(1)} videos/week`,
            detail: 'Consistent uploads compound on YouTube — the algorithm rewards predictable output.',
        });
    }

    if (shortsRatio >= 0.5 && m.shortsCount >= 3) {
        out.push({
            label: 'Strong Shorts presence',
            detail: `${m.shortsCount} Shorts vs ${m.longFormCount} long-form — Shorts are the discovery engine on YT in 2026.`,
        });
    }

    if (m.engagementRate >= 4.0) {
        out.push({
            label: `${m.engagementRate}% engagement rate`,
            detail: 'YT ER above 4% (likes+comments / views) signals genuinely useful content. Beauty avg is 2-3%.',
        });
    }

    if (m.avgViewsPerVideo >= 500 && m.subscribers > 0 && m.avgViewsPerVideo > m.subscribers * 0.05) {
        out.push({
            label: 'Reaching beyond subscribers',
            detail: `Avg ${m.avgViewsPerVideo.toLocaleString()} views/video — you\'re hitting non-subscribers via Suggested + Search.`,
        });
    }

    if (out.length === 0) {
        out.push({
            label: 'YouTube channel is alive',
            detail: 'Most medspas don\'t even have a YouTube presence. You\'re building an asset here — it compounds for years.',
        });
    }

    return out.slice(0, 3);
}

function ytFocus(m: YTCoachingInput): FocusAction[] {
    const out: FocusAction[] = [];
    const videosPerWeek = (m.videosInPeriod / m.days) * 7;
    const shortsRatio = m.videosInPeriod > 0 ? m.shortsCount / m.videosInPeriod : 0;

    // Cadence
    if (videosPerWeek < 1) {
        out.push({
            title: 'Post 1 Short to YouTube this week',
            action: 'YT rewards consistency. Even 1 video/week beats sporadic batches. Shorts are the lowest-friction format.',
            example: 'Repurpose your top IG Reel from this week — download (no watermark) → upload to YT Shorts. ~5 min, free reach.',
        });
    }

    // Shorts mix
    if (shortsRatio < 0.4 && m.videosInPeriod > 0) {
        out.push({
            title: 'Shift to a Shorts-first cadence',
            action: 'Shorts get 10-50x more impressions than long-form on YT in 2026. They\'re your discovery funnel into long-form + subscribers.',
            example: 'Goal: 3 Shorts + 1 long-form per week. Reuse your IG Reels as Shorts. Long-form = "Treatment 101" 5-8 min explainers.',
        });
    }

    // Engagement
    if (m.engagementRate < 3.0 && m.recentVideoViews > 100) {
        out.push({
            title: 'Add a question pin to your top video',
            action: 'Pinned comments with questions drive 3x more comment activity, which boosts the video in the algorithm.',
            example: 'Pin a comment like: "What treatment do you wish I covered next? Drop it below 👇" on your top-performing video.',
        });
    }

    // Thumbnails / titles (universal YT lever)
    if (out.length < 3) {
        out.push({
            title: 'A/B test thumbnails on your top long-form video',
            action: 'Thumbnail CTR is THE single biggest lever on YT long-form. A 2x CTR doubles your views overnight.',
            example: 'In YT Studio, pick a video with views < expected. Try a new thumbnail with a face + 3-word text overlay. Compare CTR after 7 days.',
        });
    }

    if (out.length < 3) {
        out.push({
            title: 'Build one "Treatment 101" long-form video',
            action: 'Long-form ranks in YT search forever. One good "What is Botox" or "Lip Filler 101" can drive consults for years.',
            example: 'Script: 30s hook → 4 min explainer → 30s "what to expect" → 30s CTA. Film with your injector. Keyword in title + description.',
        });
    }

    if (out.length < 3) {
        out.push({
            title: 'Cross-promote your channel in IG bio',
            action: 'IG audience → YT subscriber is your highest-converting growth path. Most accounts forget to even mention YT.',
            example: 'Add to IG bio: "🎥 Watch our YouTube → [link]." Pin a YT-trailer Reel to your IG grid.',
        });
    }

    return out.slice(0, 3);
}

function ytNextSkill(m: YTCoachingInput): NextSkill {
    const videosPerWeek = (m.videosInPeriod / m.days) * 7;

    if (videosPerWeek < 1) {
        return {
            title: 'Build a 1-video-per-week habit',
            level: 'foundational',
            why: 'Consistency unlocks the YouTube algorithm. Even 1 video/week (especially Shorts) starts compounding subscriber + view growth within 60 days.',
            how: [
                'Block 2 hours every Monday: download your top IG Reel of the week, re-upload to YT Shorts.',
                'Use YT-native captions and a strong title (not "Reel" — write a search-friendly title).',
                'Track: shorts views weekly. Goal: 3x in 60 days from doing this consistently.',
            ],
        };
    }

    if (m.shortsCount > 0 && m.longFormCount === 0) {
        return {
            title: 'Add long-form to your YT mix',
            level: 'intermediate',
            why: 'Shorts drive discovery, but long-form drives subscribers and ranks in YT search forever. The combo is what separates a channel from a clip-dump.',
            how: [
                'Pick 1 evergreen topic: "What is [your top treatment]?" Outline a 5-8 min video.',
                'Film with your injector. Hook (30s) → Explainer (4 min) → Aftercare (1 min) → CTA (30s).',
                'Title with a real search term: "Botox for Beginners: What to Expect at Your First Appointment."',
            ],
        };
    }

    return {
        title: 'Master YT thumbnail + title CTR',
        level: 'advanced',
        why: 'You have the cadence and format mix. The next leap is making each video work harder. Thumbnails control 80%+ of click-through, which controls everything downstream.',
        how: [
            'Study 5 top medspa/aesthetics YT channels. Screenshot their best-performing thumbnails. Note: face? text overlay? color?',
            'For your next 5 long-form videos, design 2 thumbnails per video. A/B test in YT Studio.',
            'Goal: lift average CTR from baseline to 5%+. Track in YT Analytics weekly.',
        ],
    };
}

export function generateYTCoachingPlan(input: YTCoachingInput): CoachingPlan {
    return {
        strengths: ytStrengths(input),
        focusThisWeek: ytFocus(input),
        nextSkill: ytNextSkill(input),
    };
}
