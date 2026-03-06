/**
 * /api/content/suggest-caption
 * POST: Generate AI caption suggestions using Claude Haiku
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

export async function POST(req: Request) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!ANTHROPIC_API_KEY) {
        return NextResponse.json({ error: 'AI caption service not configured' }, { status: 503 });
    }

    try {
        const body = await req.json();
        const { platforms = [], postType = 'feed', captionFragment = '', context = '' } = body;

        const platformList = platforms.join(', ') || 'social media';
        const prompt = `You are a social media copywriter for Chin Up Aesthetics, a premium medical spa in Atlanta, GA offering treatments like microneedling, Botox, dermal fillers, hydrafacials, chemical peels, and midface procedures.

Generate exactly 3 caption suggestions for a ${postType} post on ${platformList}.

${captionFragment ? `The user started writing: "${captionFragment}" — build on their idea.` : ''}
${context ? `Additional context: ${context}` : ''}

Guidelines:
- Professional yet warm and approachable tone
- Include relevant emojis sparingly (2-3 max)
- Add 5-8 relevant hashtags at the end
- Keep under 2200 characters each
- Tailor hashtags per platform (e.g., #AtlantaMedSpa for IG, broader tags for FB)
- For Reels: start with a hook question or bold statement
- For Stories: keep it short and punchy with a CTA
- For Google Business: focus on services and location, skip hashtags

Return ONLY a JSON array of 3 strings. No markdown, no explanation.
Example: ["Caption 1 here #hashtag", "Caption 2 here #hashtag", "Caption 3 here #hashtag"]`;

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 2048,
                messages: [{ role: 'user', content: prompt }],
            }),
        });

        if (!response.ok) {
            const errorData = await response.text();
            console.error('[suggest-caption] Anthropic API error:', response.status, errorData);
            return NextResponse.json({ error: 'AI service error' }, { status: 502 });
        }

        const data = await response.json();
        const text = data.content?.[0]?.text || '[]';

        // Parse the JSON array from the response
        let suggestions: string[];
        try {
            suggestions = JSON.parse(text);
            if (!Array.isArray(suggestions)) {
                suggestions = [text];
            }
        } catch {
            // If JSON parsing fails, split by numbered items
            suggestions = text.split(/\d+\.\s+/).filter(Boolean).slice(0, 3);
            if (suggestions.length === 0) {
                suggestions = [text];
            }
        }

        return NextResponse.json({ suggestions: suggestions.slice(0, 3) });
    } catch (error: any) {
        console.error('[suggest-caption] Error:', error);
        return NextResponse.json({ error: error.message || 'Caption generation failed' }, { status: 500 });
    }
}
