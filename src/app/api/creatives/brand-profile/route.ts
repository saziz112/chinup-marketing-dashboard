/**
 * /api/creatives/brand-profile
 * GET:  Return cached brand profile (or generate if missing)
 * POST: Force regenerate brand profile from latest IG data
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sql } from '@vercel/postgres';
import { pgCacheGet, pgCacheSet } from '@/lib/pg-cache';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CACHE_KEY = 'brand_profile';
const CACHE_TTL_DAYS = 14;

interface BrandProfile {
    brandVoice: string;
    visualThemes: string[];
    topTreatments: string[];
    emojiStyle: string[];
    contentPillars: string[];
    promptEnhancement: string;
    generatedAt: string;
    basedOnPosts: number;
}

async function generateBrandProfile(): Promise<BrandProfile> {
    // Fetch top 20 IG posts by engagement
    const result = await sql`
        SELECT caption, post_type, likes, comments, shares, saves, views, reach, engagement_rate
        FROM social_posts
        WHERE platform = 'instagram'
          AND caption IS NOT NULL
          AND caption != ''
        ORDER BY (COALESCE(likes, 0) + COALESCE(comments, 0) + COALESCE(shares, 0) + COALESCE(saves, 0)) DESC
        LIMIT 20
    `;

    if (result.rows.length === 0) {
        throw new Error('No Instagram posts found. Run the social posts backfill first.');
    }

    const captions = result.rows.map((r, i) => `${i + 1}. [${r.post_type || 'IMAGE'}] ${r.caption}`).join('\n\n');

    const prompt = `You are a brand analyst for a medical spa called "Chin Up! Aesthetics" in Atlanta, GA (locations in Decatur, Smyrna, and Kennesaw).

Below are their top ${result.rows.length} performing Instagram posts by engagement. Analyze these captions to extract:

1. Brand Voice: Describe the tone, personality, and communication style in 2-3 sentences
2. Visual Themes: Based on the captions, what visual themes should their images have? List 4-6 themes
3. Top Treatments: List the top 5 treatments/services mentioned
4. Emoji Style: What emojis are commonly used? List 5-8 most frequent
5. Content Pillars: Identify 3-5 content themes/pillars
6. Prompt Enhancement: Write a 1-2 sentence string that should be prepended to AI image generation prompts to maintain brand consistency. Focus on visual style, mood, and aesthetic. Example format: "Luxurious med spa aesthetic, warm golden lighting, clean professional environment, diverse Atlanta clientele"

Return ONLY valid JSON with these exact keys: brandVoice, visualThemes, topTreatments, emojiStyle, contentPillars, promptEnhancement

CAPTIONS:
${captions}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_API_KEY!,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1024,
            messages: [{ role: 'user', content: prompt }],
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('[brand-profile] Anthropic API error:', response.status, errorText);
        throw new Error('AI analysis service error');
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '{}';

    let parsed: Partial<BrandProfile>;
    try {
        // Handle potential markdown code blocks
        const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        parsed = JSON.parse(jsonStr);
    } catch {
        console.error('[brand-profile] Failed to parse response:', text);
        throw new Error('Failed to parse brand analysis');
    }

    const profile: BrandProfile = {
        brandVoice: parsed.brandVoice || '',
        visualThemes: parsed.visualThemes || [],
        topTreatments: parsed.topTreatments || [],
        emojiStyle: parsed.emojiStyle || [],
        contentPillars: parsed.contentPillars || [],
        promptEnhancement: parsed.promptEnhancement || '',
        generatedAt: new Date().toISOString(),
        basedOnPosts: result.rows.length,
    };

    await pgCacheSet(CACHE_KEY, profile, CACHE_TTL_DAYS);
    return profile;
}

export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        // Check cache first
        const cached = await pgCacheGet<BrandProfile>(CACHE_KEY);
        if (cached) {
            return NextResponse.json({ profile: cached, cached: true });
        }

        // Generate if not cached
        if (!ANTHROPIC_API_KEY) {
            return NextResponse.json({ profile: null, error: 'AI service not configured' });
        }

        const profile = await generateBrandProfile();
        return NextResponse.json({ profile, cached: false });
    } catch (error) {
        console.error('[brand-profile] Error:', error);
        return NextResponse.json({ profile: null, error: error instanceof Error ? error.message : 'Failed to generate brand profile' });
    }
}

export async function POST() {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!ANTHROPIC_API_KEY) {
        return NextResponse.json({ error: 'AI service not configured' }, { status: 503 });
    }

    try {
        const profile = await generateBrandProfile();
        return NextResponse.json({ profile, cached: false });
    } catch (error) {
        console.error('[brand-profile] Regenerate error:', error);
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to regenerate' }, { status: 500 });
    }
}
