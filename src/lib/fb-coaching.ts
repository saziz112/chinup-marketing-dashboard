/**
 * Facebook Page Coaching (rule-based)
 *
 * FB data we have: page followers, video views, engagements, page views, ER, daily trends.
 * No post-level data is exposed yet, so coaching focuses on macro signals:
 * engagement rate trend, video view growth, follower growth, content cadence (qualitative).
 */

import type { CoachingPlan, CoachingStrength, FocusAction, NextSkill } from './ig-coaching';

interface FBCoachingInput {
    totalVideoViews: number;
    totalEngagements: number;
    totalPageViews: number;
    engagementRate: number;
    followerChange: number;
    followerChangePercent: number;
    days: number; // period length
}

function fbStrengths(m: FBCoachingInput): CoachingStrength[] {
    const out: CoachingStrength[] = [];

    if (m.engagementRate >= 1.0) {
        out.push({
            label: `${m.engagementRate}% engagement rate`,
            detail: 'FB Page engagement above 1% is strong — most medspa Pages sit at 0.2–0.5%.',
        });
    }

    if (m.totalVideoViews > 1000) {
        out.push({
            label: `${m.totalVideoViews.toLocaleString()} video views`,
            detail: 'Video is FB\'s strongest format. Reels show on Pages now and reach non-followers.',
        });
    }

    if (m.followerChangePercent >= 0.5) {
        out.push({
            label: 'Follower growth is positive',
            detail: `+${m.followerChangePercent}% this period — FB Page growth is hard, this is genuinely good.`,
        });
    }

    if (m.totalPageViews > 200) {
        out.push({
            label: 'Page is being discovered',
            detail: `${m.totalPageViews.toLocaleString()} page views means people are checking you out — keep About/Hours/CTA fresh.`,
        });
    }

    if (out.length === 0) {
        out.push({
            label: 'FB Page is live',
            detail: 'Even modest activity is a foundation. Most medspas neglect FB entirely — being present already differentiates.',
        });
    }

    return out.slice(0, 3);
}

function fbFocus(m: FBCoachingInput): FocusAction[] {
    const out: FocusAction[] = [];

    if (m.totalVideoViews < 500 * (m.days / 30)) {
        out.push({
            title: 'Cross-post Reels from IG to FB this week',
            action: 'FB Reels reach non-followers via the Reels feed. Same content, ~zero extra effort.',
            example: 'In Meta Business Suite: when scheduling an IG Reel, toggle "Also share to Facebook" + "Allow others to remix." Free reach.',
        });
    }

    if (m.engagementRate < 0.5) {
        out.push({
            title: 'Switch FB content to question-format posts',
            action: 'FB favors comments (Page Engagement signal). Questions get 5–10x more comments than statements.',
            example: '"Which treatment do you wish you knew about sooner — Botox or Filler?" beats "We offer Botox and Filler" every time.',
        });
    }

    if (m.totalPageViews > 0 && m.totalEngagements / Math.max(m.totalPageViews, 1) < 0.05) {
        out.push({
            title: 'Pin a high-converting post to your FB Page',
            action: 'Page visitors arrive curious. The pinned post is your storefront — make it the best BA or your booking offer.',
            example: 'Pin a 3-photo BA carousel with caption "[Treatment Name] at Chin Up Aesthetics. DM CONSULT to book." Update monthly.',
        });
    }

    if (m.followerChangePercent < 0.3) {
        out.push({
            title: 'Add a FB-only offer once a month',
            action: 'FB followers tend to be older / higher-LTV. A FB-exclusive promo drives Page follows AND bookings.',
            example: '"$50 off your first treatment when booking from our FB Page this month." Post weekly with the offer reminder.',
        });
    }

    // Always include a strategic move
    if (out.length < 3) {
        out.push({
            title: 'Set up FB → IG cross-posting once and forget',
            action: 'Connecting accounts in Meta Business Suite means everything you do on IG mirrors to FB automatically.',
            example: 'Meta Business Suite → Settings → Linked Accounts → connect IG Business Account. 5 min setup, ongoing leverage.',
        });
    }

    if (out.length < 3) {
        out.push({
            title: 'Audit your FB About page',
            action: 'About page is what shows in search results. Most medspa FB Pages have stale info that costs leads.',
            example: 'Update: hours, phone, services list, ONE CTA link (book consult), high-quality cover photo. 15 min, lasting impact.',
        });
    }

    return out.slice(0, 3);
}

function fbNextSkill(m: FBCoachingInput): NextSkill {
    if (m.totalVideoViews < 200 * (m.days / 30)) {
        return {
            title: 'Build a FB Reels cross-posting habit',
            level: 'foundational',
            why: 'FB Reels show in a separate feed and reach people who don\'t follow you. Cross-posting from IG is the highest-ROI organic move on FB.',
            how: [
                'Open Meta Business Suite → Settings → Connected Accounts → connect your IG.',
                'For your next 5 IG Reels, toggle "Share to Facebook" before posting.',
                'Track FB video views weekly. Goal: 2x in 60 days from this single change.',
            ],
        };
    }

    if (m.engagementRate < 1.0) {
        return {
            title: 'Master the FB question-post format',
            level: 'intermediate',
            why: 'FB\'s algorithm weights comments heavier than IG\'s. A great question post can outperform 10 promo posts. This is the single biggest FB skill.',
            how: [
                'Study 5 viral FB Pages in beauty/wellness. Note: how do they end posts?',
                'Use this template weekly: "Quick question — [observation]. What\'s YOUR experience?" Then engage in the comments.',
                'Goal: 3+ comments per post within 24h. Reply to every single one.',
            ],
        };
    }

    return {
        title: 'Build a FB community routine',
        level: 'advanced',
        why: 'Your engagement is solid. The next leap is FB Groups — they\'re where the most engaged audience lives, and they convert at far higher rates than Page followers.',
        how: [
            'Create a "Chin Up Aesthetics Insiders" private FB Group. Approve members manually.',
            'Post 2x/week inside: educational content, sneak peeks of new treatments, member-only offers.',
            'Goal: 100 members in 90 days, then layer in a monthly Live Q&A with the injector.',
        ],
    };
}

export function generateFBCoachingPlan(input: FBCoachingInput): CoachingPlan {
    return {
        strengths: fbStrengths(input),
        focusThisWeek: fbFocus(input),
        nextSkill: fbNextSkill(input),
    };
}
