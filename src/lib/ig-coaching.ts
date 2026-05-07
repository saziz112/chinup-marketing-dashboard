/**
 * Instagram Coaching Engine
 *
 * Generates directional, growth-oriented coaching for the social media manager
 * based on current IG metrics. This is *prescriptive* (what to do next), distinct
 * from the reactive nudges in ig-benchmarks.ts (which flag problems).
 *
 * Three outputs:
 *   1. strengths       — what she's doing well (positive reinforcement)
 *   2. focusThisWeek   — 3 specific, actionable moves with concrete examples
 *   3. nextSkill       — one progressive skill to develop, picked based on current level
 */

export interface CoachingStrength {
    label: string;
    detail: string;
}

export interface FocusAction {
    title: string;
    action: string;
    example: string;
}

export type SkillLevel = 'foundational' | 'intermediate' | 'advanced';

export interface NextSkill {
    title: string;
    level: SkillLevel;
    why: string;
    how: string[];
}

export interface CoachingPlan {
    strengths: CoachingStrength[];
    focusThisWeek: FocusAction[];
    nextSkill: NextSkill;
}

interface CoachingInput {
    reelsPerWeek: number;
    feedPostsPerWeek: number;
    carouselMixPercent: number;
    storiesActive: number;
    engagementRate: number;
    saveRate: number;
    sendRate: number;
    replyRate?: number;
    avgReplyHours?: number | null;
    totalComments?: number;
    followerChange?: number;
    followerChangePercent?: number;
}

/**
 * Identify what's working — positive reinforcement matters for confidence.
 * Returns up to 3 strengths.
 */
function identifyStrengths(m: CoachingInput): CoachingStrength[] {
    const strengths: CoachingStrength[] = [];

    if (m.reelsPerWeek >= 4) {
        strengths.push({
            label: 'Reels cadence is strong',
            detail: `${m.reelsPerWeek}/wk keeps you on the algorithm's good side. The compounding will pay off — keep it up.`,
        });
    }

    if (m.carouselMixPercent >= 30) {
        strengths.push({
            label: 'Smart format mix',
            detail: `${m.carouselMixPercent}% carousels — you\'re using the highest-ER format on IG (~1.92% avg). Many medspas under-use this.`,
        });
    }

    if (m.engagementRate >= 2.0) {
        strengths.push({
            label: `${m.engagementRate}% ER beats medspa average`,
            detail: 'Beauty industry brand accounts average 0.3–1%. You\'re in the top quartile.',
        });
    }

    if (m.saveRate >= 1.0) {
        strengths.push({
            label: 'People are saving your content',
            detail: `Save rate of ${m.saveRate}% is one of the strongest 2026 algo signals. Saves > likes.`,
        });
    }

    if (m.sendRate >= 0.5) {
        strengths.push({
            label: 'Your content gets shared',
            detail: `Send rate of ${m.sendRate}% — followers DM your posts to friends. Top-tier sharability signal.`,
        });
    }

    if (m.storiesActive >= 3) {
        strengths.push({
            label: 'Daily Stories habit is locked in',
            detail: `${m.storiesActive} active Stories keeps you top-of-feed. Stories drive 3–5x higher CTR than bio links.`,
        });
    }

    if (m.replyRate !== undefined && m.replyRate >= 80 && (m.totalComments ?? 0) >= 5) {
        strengths.push({
            label: 'Excellent reply rate',
            detail: `${Math.round(m.replyRate)}% of comments get a response. This boosts post velocity AND makes followers feel seen.`,
        });
    }

    if ((m.followerChangePercent ?? 0) >= 1.0) {
        strengths.push({
            label: 'Healthy follower growth',
            detail: `+${m.followerChangePercent}% in this period — at the high end of medspa benchmarks (1–3% monthly = strong).`,
        });
    }

    // Fallback if literally nothing is hitting good — find the *least bad* signal to acknowledge effort
    if (strengths.length === 0) {
        if (m.feedPostsPerWeek >= 2) {
            strengths.push({
                label: 'Posting consistently',
                detail: 'You\'re showing up. That\'s the foundation — quality compounds from there.',
            });
        } else if (m.storiesActive >= 1) {
            strengths.push({
                label: 'Active in Stories today',
                detail: 'Stories keep you top-of-feed. Build on this with feed-post consistency.',
            });
        } else {
            strengths.push({
                label: 'Fresh start opportunity',
                detail: 'Every great account had a baseline — this is a chance to build a deliberate habit.',
            });
        }
    }

    return strengths.slice(0, 3);
}

/**
 * Generate 3 specific, actionable moves for this week.
 * Prioritized by leverage: format gaps > engagement signals > consistency.
 */
function generateFocus(m: CoachingInput): FocusAction[] {
    const focus: FocusAction[] = [];

    // Priority 1: Reels cadence (algorithm-critical)
    if (m.reelsPerWeek < 4) {
        const needed = Math.max(1, Math.ceil(4 - m.reelsPerWeek));
        focus.push({
            title: `Post ${needed} more Reel${needed > 1 ? 's' : ''} this week`,
            action: 'Pick a recurring format you can batch-shoot in 30 minutes. The algorithm rewards 4+/wk.',
            example: 'Try a "1-Min Treatment Explainer" series — point at a treatment, give 3 quick benefits, end with "DM us to book." Same format, different treatment each week.',
        });
    }

    // Priority 2: Carousel underuse (highest-ER format)
    if (m.carouselMixPercent < 25) {
        focus.push({
            title: 'Build one carousel this week',
            action: 'Carousels have 4x the ER of single images. Start with a simple 5-slide template.',
            example: 'BA Reveal: Slide 1 hook ("This client got Botox 2 weeks ago…") → Slides 2–4 process pics → Slide 5 CTA ("Save this for your consult"). Reuse this template forever.',
        });
    }

    // Priority 3: Save-driving CTAs
    if (m.saveRate < 1.0 || m.sendRate < 0.5) {
        focus.push({
            title: 'Add a save/share CTA to every post',
            action: 'Saves and sends are the strongest 2026 algo signals. Most posts don\'t ask for them.',
            example: '"Save this for your next consult" • "Send to a friend who needs this" • "Bookmark before you forget." Pick one CTA per post.',
        });
    }

    // Priority 4: Reply hygiene
    if ((m.totalComments ?? 0) >= 5 && (m.replyRate ?? 100) < 70) {
        focus.push({
            title: 'Set a daily 10-minute reply window',
            action: 'Replying within an hour boosts post velocity. Pick a fixed time (e.g., 10am after coffee).',
            example: 'Open IG, swipe through new comments, type a quick reply (even just an emoji + "thanks!"). Goal: 80%+ replied within 4h.',
        });
    }

    // Priority 5: Story consistency (if not already daily)
    if (m.storiesActive < 1) {
        focus.push({
            title: 'Post one Story today',
            action: 'Stories keep you top-of-feed. A blank story bar costs you visibility.',
            example: 'Easiest win: poll Story ("Botox or Filler — which would you try first?"). Takes 60 seconds, generates DMs.',
        });
    }

    // Priority 6: Pinned posts (free conversion lever)
    if (focus.length < 3) {
        focus.push({
            title: 'Audit your 3 pinned posts',
            action: 'Pinned posts sit at the top of your grid forever. They should drive bookings, not be your latest content.',
            example: 'Pin: (1) Best BA carousel, (2) Provider intro Reel, (3) Current promotion. Update monthly.',
        });
    }

    if (focus.length < 3) {
        focus.push({
            title: 'Repurpose your top post to TikTok + YT Shorts',
            action: 'Your best Reel only lived on IG. Same effort = 3x distribution.',
            example: 'Download your top Reel (no watermark — use a third-party tool) → upload to TikTok with similar caption → upload to YouTube Shorts.',
        });
    }

    return focus.slice(0, 3);
}

/**
 * Pick one progressive skill based on current level.
 * Foundational → Intermediate → Advanced.
 */
function pickNextSkill(m: CoachingInput): NextSkill {
    // Foundational: still building consistency
    if (m.reelsPerWeek < 3 || m.feedPostsPerWeek < 3) {
        return {
            title: 'Master the "Hook in 3 Seconds" Reel structure',
            level: 'foundational',
            why: 'The first 3 seconds of a Reel decide whether someone keeps watching. This single skill multiplies the impact of every Reel you make. Once locked in, your view counts compound.',
            how: [
                'Study 5 Reels with 100K+ views. Note: what happens in the first 3 seconds?',
                'Use one of these hook templates: a) Bold claim ("Stop doing this if you want…"), b) Curiosity gap ("What I wish I knew before…"), c) Visual reveal (start mid-action).',
                'For your next 5 Reels, write the hook FIRST before filming.',
            ],
        };
    }

    // Intermediate: consistency is there, time to build a franchise
    if (m.carouselMixPercent < 25 || m.saveRate < 1.0) {
        return {
            title: 'Launch a recurring content franchise',
            level: 'intermediate',
            why: 'Recurring series outperform one-offs because the algorithm builds audience expectation, and YOU build a content library. One template = 52 posts/year.',
            how: [
                'Pick one franchise concept: "Treatment Tuesday" (educational), "Friday Faces" (BAs with consent), "Myth Monday" (busts a misconception), or a similar weekly cadence.',
                'Create a reusable carousel template in Canva (5–7 slides, consistent fonts/colors).',
                'Batch-create 4 weeks worth in one session. Schedule with Meta Business Suite.',
            ],
        };
    }

    // Advanced: solid habits, ER is good — push into trends + cross-platform
    return {
        title: 'Develop a trend-riding playbook',
        level: 'advanced',
        why: 'You have the foundation. Now you can react fast to trending audio/formats and 10x reach without losing brand voice. This is what separates good SMMs from elite ones.',
        how: [
            'Spend 15 min/day in IG Reels feed — bookmark trending audio with your "audio" save folder.',
            'Build a "Trend Conversion Bank" — 10 medspa-relevant angles you can plug ANY trending audio into (e.g., "POV: my filler appointment hits different").',
            'Set a 24h rule: when you save a trending audio, post your medspa version within 24 hours or it\'s already cold.',
        ],
    };
}

export function generateCoachingPlan(input: CoachingInput): CoachingPlan {
    return {
        strengths: identifyStrengths(input),
        focusThisWeek: generateFocus(input),
        nextSkill: pickNextSkill(input),
    };
}
