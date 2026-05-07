/**
 * AI-Powered Facebook Coaching (Claude Haiku 4.5)
 * 12h cache. Returns null on failure → caller falls back to fb-coaching.ts rule-based.
 */

import { createMemCache } from '@/lib/mem-cache';
import type { CoachingPlan } from './ig-coaching';

const aiCache = createMemCache<CoachingPlan>(12 * 60 * 60 * 1000);

export interface AIFBCoachingInput {
    period: '7d' | '30d' | '90d';
    pageName: string;
    metrics: {
        followers: number;
        followerChange: number;
        followerChangePercent: number;
        totalVideoViews: number;
        totalEngagements: number;
        totalPageViews: number;
        engagementRate: number;
    };
}

function buildPrompt(input: AIFBCoachingInput): string {
    const m = input.metrics;
    return `You are coaching Sharia, a young and ambitious social media manager at Chin Up! Aesthetics, a premium medical spa in metro Atlanta. She's eager to grow but doesn't always know what to do or how to improve. Your job: give her direction, build her confidence on the FB front specifically.

She manages the Facebook Page "${input.pageName}". Here's the last ${input.period}:

PAGE METRICS:
- Followers: ${m.followers.toLocaleString()} (${m.followerChange >= 0 ? '+' : ''}${m.followerChange} this period, ${m.followerChangePercent}%)
- Total video views: ${m.totalVideoViews.toLocaleString()}
- Total engagements (likes+comments+shares): ${m.totalEngagements.toLocaleString()}
- Total page views: ${m.totalPageViews.toLocaleString()}
- Engagement rate: ${m.engagementRate}% (medspa FB Page avg: 0.2-0.5%, good: 1%+)

CONTEXT (specific to FB Pages in 2026):
- FB Reels reach non-followers via the Reels feed — cross-posting from IG is the single highest-ROI move
- FB algorithm heavily weights comments (more than likes/shares) — questions outperform statements 5-10x
- FB Pages skew older / higher-income audience — different from IG. Treat as primary booking channel.
- We don't have post-level data exposed yet. Coaching has to be macro/strategic.

INSTRUCTIONS:
Generate JSON in this EXACT shape (no markdown, just JSON):

{
  "strengths": [
    { "label": "<5-8 words>", "detail": "<1 sentence with specific numbers>" }
  ],
  "focusThisWeek": [
    {
      "title": "<imperative + specific, e.g. 'Cross-post 3 Reels to FB'>",
      "action": "<1-2 sentence why+how>",
      "example": "<copy-paste-ready prescription>"
    }
  ],
  "nextSkill": {
    "title": "<one growth skill>",
    "level": "<foundational | intermediate | advanced>",
    "why": "<1-2 sentences>",
    "how": ["<step 1>", "<step 2>", "<step 3>"]
  }
}

RULES:
- 1-3 strengths (be generous; encourage)
- EXACTLY 3 focusThisWeek items, prioritized by leverage. FB-specific moves (Reels cross-post, question posts, FB Groups, About page audit, FB-only offers) should dominate.
- 1 nextSkill — pick level based on her current state (foundational if low video views, advanced if engagement is solid)
- Be SPECIFIC: "Cross-post your top 3 IG Reels" beats "post more"
- Tone: direct, warm, mentor-like
- DO NOT include compliance/HIPAA advice or paid ads
- DO NOT suggest IG-specific moves — this is FB coaching only`;
}

export async function generateAIFBCoachingPlan(
    input: AIFBCoachingInput,
): Promise<CoachingPlan | null> {
    const m = input.metrics;
    const cacheKey = [
        'ai_coach_fb',
        input.period,
        Math.round(m.engagementRate * 10),
        Math.round(m.totalVideoViews / 100) * 100,
        Math.round(m.followerChangePercent),
    ].join('|');

    const cached = aiCache.get(cacheKey);
    if (cached) return cached;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;

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
        console.warn('[fb-coaching-ai] generation failed:', err instanceof Error ? err.message : err);
        return null;
    }
}
