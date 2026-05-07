/**
 * AI-Powered Instagram Coaching
 *
 * Calls Claude Haiku 4.5 with the manager's current metrics + sample of top/bottom posts
 * to generate personalized, more nuanced coaching than rule-based ig-coaching.ts can offer.
 *
 * Returns the same CoachingPlan shape so the UI is interchangeable.
 * Cached 12h to control cost (~$0.008/call → ~$1/month at 4 calls/day).
 *
 * Falls back gracefully — caller wraps in try/catch and uses rule-based plan if this fails.
 */

import { createMemCache } from '@/lib/mem-cache';
import type { CoachingPlan } from './ig-coaching';

const aiCache = createMemCache<CoachingPlan>(12 * 60 * 60 * 1000); // 12h TTL

export interface AICoachingInput {
    period: '7d' | '30d' | '90d';
    metrics: {
        reelsPerWeek: number;
        feedPostsPerWeek: number;
        carouselMixPercent: number;
        storiesActive: number;
        engagementRate: number;
        saveRate: number;
        sendRate: number;
        followers: number;
        followerChange: number;
        followerChangePercent: number;
        replyRate?: number;
        avgReplyHours?: number | null;
        totalComments?: number;
    };
    topPosts: Array<{
        caption: string;
        mediaType: string;
        engagementRate: number;
        reach: number;
        saved: number;
        shares: number;
    }>;
    bottomPosts: Array<{
        caption: string;
        mediaType: string;
        engagementRate: number;
        reach: number;
    }>;
}

function buildPrompt(input: AICoachingInput): string {
    const m = input.metrics;
    const topLines = input.topPosts.map((p, i) => {
        const t = p.mediaType === 'VIDEO' ? 'Reel' : p.mediaType === 'CAROUSEL_ALBUM' ? 'Carousel' : 'Photo';
        return `  ${i + 1}. [${t}] ER ${p.engagementRate}% • ${p.reach.toLocaleString()} reach • ${p.saved} saves • ${p.shares} shares — "${(p.caption || '(no caption)').substring(0, 100)}"`;
    }).join('\n');
    const bottomLines = input.bottomPosts.map((p, i) => {
        const t = p.mediaType === 'VIDEO' ? 'Reel' : p.mediaType === 'CAROUSEL_ALBUM' ? 'Carousel' : 'Photo';
        return `  ${i + 1}. [${t}] ER ${p.engagementRate}% • ${p.reach.toLocaleString()} reach — "${(p.caption || '(no caption)').substring(0, 100)}"`;
    }).join('\n');

    return `You are coaching Sharia, a young and ambitious social media manager at Chin Up! Aesthetics, a premium medical spa in metro Atlanta. She's eager to grow and improve but doesn't always know what to do next or how. Your job: give her direction, build her confidence, and grow her skills.

She is responsible for the Instagram account @chinupaesthetics. Here's her performance for the last ${input.period}:

ACCOUNT METRICS:
- Followers: ${m.followers.toLocaleString()} (${m.followerChange >= 0 ? '+' : ''}${m.followerChange} this period, ${m.followerChangePercent}%)
- Reels per week: ${m.reelsPerWeek} (target: 4+)
- Total feed posts per week: ${m.feedPostsPerWeek} (target: 4-5)
- Carousel mix: ${m.carouselMixPercent}% of feed (target: 30%+ — carousels have highest ER on IG)
- Active Stories right now: ${m.storiesActive} (target: 3+/day)
- Engagement rate: ${m.engagementRate}% (medspa avg: 0.3-1%, good: 2%+, excellent: 4%+)
- Save rate: ${m.saveRate}% (top 2026 algo signal — target: 1%+)
- Send rate: ${m.sendRate}% (DM shares — target: 0.5%+)
${m.totalComments && m.totalComments > 0 ? `- Comment reply rate: ${m.replyRate}% on ${m.totalComments} comments (target: 80%+)` : ''}
${m.avgReplyHours != null ? `- Avg reply time: ${m.avgReplyHours}h (target: <2h)` : ''}

TOP 3 POSTS BY ER:
${topLines || '  (none)'}

BOTTOM 3 POSTS BY ER:
${bottomLines || '  (none)'}

INSTRUCTIONS:
Generate personalized coaching as JSON in this EXACT shape (no markdown, no commentary, just JSON):

{
  "strengths": [
    { "label": "<short positive callout, 5-8 words>", "detail": "<1-sentence specific reason, reference actual numbers>" }
  ],
  "focusThisWeek": [
    {
      "title": "<imperative action verb + specific target, e.g. 'Post 2 more Reels this week'>",
      "action": "<1-2 sentence why + how>",
      "example": "<concrete copy-paste-ready example or template, reference her actual top-performer formats when possible>"
    }
  ],
  "nextSkill": {
    "title": "<one growth skill name>",
    "level": "<one of: foundational | intermediate | advanced>",
    "why": "<1-2 sentences on why this skill matters and how it builds on what she's already doing>",
    "how": [
      "<step 1, concrete and specific>",
      "<step 2>",
      "<step 3>"
    ]
  }
}

RULES:
- 1-3 strengths (skip if literally nothing is good — but be generous; encourage)
- EXACTLY 3 items in focusThisWeek, prioritized by leverage (algorithm-critical first)
- 1 nextSkill — pick level based on her current state (foundational if Reels<3/wk, advanced if all baseline metrics are strong, intermediate otherwise)
- Reference HER top posts when suggesting formats ("your BA carousel got X% ER — replicate that template")
- Be SPECIFIC: "Post 2 BA carousels" beats "post more carousels"
- Keep tone direct, warm, mentor-like. She's young and learning — encourage growth, don't lecture
- Examples should be copy-paste actionable, not vague platitudes
- DO NOT include compliance/legal/HIPAA advice — handled elsewhere
- DO NOT mention paid ads — this is organic only`;
}

/**
 * Generate AI coaching plan via Claude Haiku 4.5.
 * Returns null on any failure — caller falls back to rule-based plan.
 */
export async function generateAICoachingPlan(
    input: AICoachingInput,
): Promise<CoachingPlan | null> {
    // Cache key includes period + metric snapshot — invalidates when metrics shift meaningfully
    const m = input.metrics;
    const cacheKey = [
        'ai_coach',
        input.period,
        // Round metrics to reduce cache churn from tiny fluctuations
        Math.round(m.reelsPerWeek),
        Math.round(m.feedPostsPerWeek),
        Math.round(m.carouselMixPercent / 5) * 5,
        Math.round(m.engagementRate),
        Math.round(m.saveRate * 10),
        Math.round(m.followerChangePercent),
        // Top post id hash so we re-coach when top performer changes
        input.topPosts[0]?.caption?.substring(0, 30) || '',
    ].join('|');

    const cached = aiCache.get(cacheKey);
    if (cached) return cached;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        console.warn('[ig-coaching-ai] ANTHROPIC_API_KEY not configured — falling back to rule-based');
        return null;
    }

    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 1500,
                messages: [{ role: 'user', content: buildPrompt(input) }],
            }),
        });
        if (!response.ok) {
            const err = await response.text();
            throw new Error(`Anthropic API error: ${response.status} — ${err.substring(0, 200)}`);
        }

        const aiResponse = await response.json();
        const text = aiResponse.content?.[0]?.text || '{}';
        const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

        const parsed = JSON.parse(jsonStr) as CoachingPlan;

        // Defensive validation — ensure shape is what UI expects
        if (
            !Array.isArray(parsed.strengths) ||
            !Array.isArray(parsed.focusThisWeek) ||
            !parsed.nextSkill ||
            !Array.isArray(parsed.nextSkill.how)
        ) {
            throw new Error('AI response missing required fields');
        }

        aiCache.set(cacheKey, parsed);
        return parsed;
    } catch (err) {
        console.warn('[ig-coaching-ai] generation failed:', err instanceof Error ? err.message : err);
        return null;
    }
}
