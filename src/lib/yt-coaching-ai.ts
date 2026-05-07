/**
 * AI-Powered YouTube Coaching (Claude Haiku 4.5)
 * 12h cache. Returns null on failure → caller falls back to yt-coaching.ts rule-based.
 */

import { createMemCache } from '@/lib/mem-cache';
import type { CoachingPlan } from './ig-coaching';

const aiCache = createMemCache<CoachingPlan>(12 * 60 * 60 * 1000);

export interface AIYTCoachingInput {
    period: '7d' | '30d' | '90d';
    channelTitle: string;
    metrics: {
        subscribers: number;
        videosInPeriod: number;
        shortsCount: number;
        longFormCount: number;
        engagementRate: number;
        avgViewsPerVideo: number;
        recentVideoViews: number;
        days: number;
    };
    topVideos: Array<{
        title: string;
        viewCount: number;
        likeCount: number;
        commentCount: number;
        isShort: boolean;
    }>;
}

function buildPrompt(input: AIYTCoachingInput): string {
    const m = input.metrics;
    const videosPerWeek = m.days > 0 ? (m.videosInPeriod / m.days) * 7 : 0;
    const topLines = input.topVideos.map((v, i) => {
        const t = v.isShort ? 'Short' : 'Long-form';
        return `  ${i + 1}. [${t}] ${v.viewCount.toLocaleString()} views • ${v.likeCount} likes • ${v.commentCount} comments — "${v.title.substring(0, 100)}"`;
    }).join('\n');

    return `You are coaching Sharia, a young and ambitious social media manager at Chin Up! Aesthetics, a premium medical spa in metro Atlanta. She's eager to grow but doesn't always know what to do or how to improve. Your job: give her direction, build her confidence — specifically on YouTube.

She manages the YouTube channel "${input.channelTitle}". Last ${input.period}:

CHANNEL METRICS:
- Subscribers: ${m.subscribers.toLocaleString()}
- Videos this period: ${m.videosInPeriod} (${videosPerWeek.toFixed(1)}/week)
- Shorts: ${m.shortsCount} • Long-form: ${m.longFormCount}
- Recent video views: ${m.recentVideoViews.toLocaleString()}
- Avg views per video: ${m.avgViewsPerVideo.toLocaleString()}
- Engagement rate: ${m.engagementRate}% (likes+comments / views; YT good: 4%+)

TOP VIDEOS:
${topLines || '  (none)'}

CONTEXT (specific to YouTube in 2026):
- Shorts are the discovery engine — 10-50x more impressions than long-form for new channels
- Long-form ranks in YT Search forever — one good "Treatment 101" video drives consults for years
- Thumbnail CTR is the single biggest lever on long-form — small thumbnail change can 2x views
- IG-to-YT cross-posting is the highest-ROI move for medspa channels

INSTRUCTIONS:
Generate JSON in this EXACT shape (no markdown, just JSON):

{
  "strengths": [
    { "label": "<5-8 words>", "detail": "<1 sentence with specific numbers>" }
  ],
  "focusThisWeek": [
    {
      "title": "<imperative + specific>",
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
- EXACTLY 3 focusThisWeek items, prioritized by leverage
- 1 nextSkill — pick level (foundational if <1 vid/wk, advanced if cadence + ER are strong)
- Reference HER top videos when suggesting formats ("your Shorts on X got Y views — replicate that hook")
- Be SPECIFIC: "Repurpose your top IG Reel as a Short" beats "post more"
- YT-specific moves only (no IG/FB-specific advice)
- Tone: direct, warm, mentor-like
- DO NOT include compliance/HIPAA advice or paid ads`;
}

export async function generateAIYTCoachingPlan(
    input: AIYTCoachingInput,
): Promise<CoachingPlan | null> {
    const m = input.metrics;
    const cacheKey = [
        'ai_coach_yt',
        input.period,
        m.videosInPeriod,
        m.shortsCount,
        m.longFormCount,
        Math.round(m.engagementRate),
        input.topVideos[0]?.title?.substring(0, 30) || '',
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
        console.warn('[yt-coaching-ai] generation failed:', err instanceof Error ? err.message : err);
        return null;
    }
}
