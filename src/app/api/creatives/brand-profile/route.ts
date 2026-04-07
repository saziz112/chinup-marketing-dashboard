/**
 * /api/creatives/brand-profile
 * GET:  Return cached brand profile (or generate if missing)
 * POST: Force regenerate brand profile from latest IG data + vision analysis
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sql } from '@vercel/postgres';
import { pgCacheGet, pgCacheSet } from '@/lib/pg-cache';
import { put } from '@vercel/blob';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const META_PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN;
const CACHE_KEY = 'brand_profile_v2';
const CACHE_TTL_DAYS = 14;

interface BrandProfile {
    brandVoice: string;
    visualStyle: string;
    colorPalette: string[];
    lightingStyle: string;
    compositionNotes: string;
    visualThemes: string[];
    topTreatments: string[];
    emojiStyle: string[];
    contentPillars: string[];
    promptEnhancement: string;
    referenceImageUrls: string[];
    generatedAt: string;
    basedOnPosts: number;
}

/** Fetch fresh IG media URLs for specific post IDs */
async function fetchFreshMediaUrls(postIds: string[]): Promise<Map<string, string>> {
    const urlMap = new Map<string, string>();
    if (!META_PAGE_ACCESS_TOKEN || postIds.length === 0) return urlMap;

    // Fetch each post's media_url (IG CDN URLs expire, so we need fresh ones)
    const batchSize = 5;
    for (let i = 0; i < postIds.length; i += batchSize) {
        const batch = postIds.slice(i, i + batchSize);
        const results = await Promise.allSettled(
            batch.map(async (postId) => {
                const res = await fetch(
                    `https://graph.facebook.com/v22.0/${postId}?fields=media_url,media_type&access_token=${META_PAGE_ACCESS_TOKEN}`
                );
                if (!res.ok) return null;
                const data = await res.json();
                // Only use IMAGE and CAROUSEL_ALBUM (skip VIDEO for vision analysis)
                if (data.media_type === 'VIDEO') return null;
                return { postId, mediaUrl: data.media_url as string };
            })
        );
        for (const r of results) {
            if (r.status === 'fulfilled' && r.value) {
                urlMap.set(r.value.postId, r.value.mediaUrl);
            }
        }
    }
    return urlMap;
}

/** Download IG images and re-upload to Vercel Blob for permanent storage */
async function persistReferenceImages(mediaUrls: string[]): Promise<string[]> {
    const blobUrls: string[] = [];
    for (const url of mediaUrls.slice(0, 5)) {
        try {
            const res = await fetch(url);
            if (!res.ok) continue;
            const buffer = await res.arrayBuffer();
            const blob = await put(
                `brand-references/ref_${Date.now()}_${Math.random().toString(36).substr(2, 6)}.jpg`,
                Buffer.from(buffer),
                { access: 'public', contentType: 'image/jpeg' }
            );
            blobUrls.push(blob.url);
        } catch {
            // Skip failed downloads
        }
    }
    return blobUrls;
}

async function generateBrandProfile(): Promise<BrandProfile> {
    // Step 1: Get top 15 IG posts by engagement (need extras in case some are videos)
    const result = await sql`
        SELECT post_id, caption, post_type, media_url, likes, comments, shares, saves, views, reach, engagement_rate
        FROM social_posts
        WHERE platform = 'instagram'
          AND caption IS NOT NULL
          AND caption != ''
        ORDER BY (COALESCE(likes, 0) + COALESCE(comments, 0) + COALESCE(shares, 0) + COALESCE(saves, 0)) DESC
        LIMIT 15
    `;

    if (result.rows.length === 0) {
        throw new Error('No Instagram posts found. Run the social posts backfill first.');
    }

    // Step 2: Fetch fresh media URLs from IG API (CDN URLs expire)
    const postIds = result.rows.map(r => r.post_id);
    const freshUrls = await fetchFreshMediaUrls(postIds);

    // Step 3: Build image content blocks for Claude Vision (top 8 images)
    const imageBlocks: { type: 'image'; source: { type: 'url'; url: string } }[] = [];
    const captionTexts: string[] = [];
    const imageMediaUrls: string[] = [];

    for (const row of result.rows) {
        const freshUrl = freshUrls.get(row.post_id);
        if (!freshUrl) continue; // Skip videos or failed fetches
        if (imageBlocks.length >= 8) break;

        imageBlocks.push({
            type: 'image',
            source: { type: 'url', url: freshUrl },
        });
        captionTexts.push(`Post ${imageBlocks.length}: [${row.post_type || 'IMAGE'}] ${row.caption || '(no caption)'} | Likes: ${row.likes}, Comments: ${row.comments}, Saves: ${row.saves}`);
        imageMediaUrls.push(freshUrl);
    }

    if (imageBlocks.length < 3) {
        // Fallback to caption-only analysis if not enough images
        console.warn(`[brand-profile] Only ${imageBlocks.length} images available, falling back to caption+image hybrid`);
    }

    // Step 4: Build Claude Vision request with images + captions
    const visionPrompt = `You are a brand visual identity analyst for "Chin Up! Aesthetics", a medical spa in Atlanta, GA (locations in Decatur, Smyrna, and Kennesaw).

I'm showing you their ${imageBlocks.length} top-performing Instagram images along with their captions and engagement metrics.

Analyze BOTH the visual elements of the images AND the caption text to create a comprehensive brand profile.

For the VISUAL analysis, pay close attention to:
- Exact color palette (list specific hex codes or color names you see recurring)
- Lighting style (natural, studio, warm, cool, soft, dramatic)
- Composition patterns (close-ups, full body, environmental, flat lay, etc.)
- Background environments (clinical, natural, lifestyle, studio, etc.)
- Subject matter (people, treatments, products, spaces)
- Editing/filter style (saturated, muted, warm-toned, high contrast, etc.)
- Overall mood and aesthetic feeling

For the TEXT analysis, examine:
- Brand voice and tone
- Common treatments mentioned
- Emoji usage patterns
- Content themes

Return ONLY valid JSON with these exact keys:
{
  "brandVoice": "2-3 sentences describing tone, personality, communication style",
  "visualStyle": "2-3 sentences describing the overall visual aesthetic, mood, and photographic style seen across the images",
  "colorPalette": ["color1", "color2", ...],
  "lightingStyle": "1-2 sentences about typical lighting",
  "compositionNotes": "1-2 sentences about typical framing and composition",
  "visualThemes": ["theme1", "theme2", ...],
  "topTreatments": ["treatment1", "treatment2", ...],
  "emojiStyle": ["emoji1", "emoji2", ...],
  "contentPillars": ["pillar1", "pillar2", ...],
  "promptEnhancement": "A detailed 2-4 sentence prompt prefix for AI image generation that captures the EXACT visual style of these images. Be very specific about colors, lighting, mood, backgrounds, and subject framing. This will be prepended to image generation prompts to maintain brand consistency."
}

CAPTIONS & METRICS:
${captionTexts.join('\n\n')}`;

    // Build message content: interleave images with the text prompt
    const messageContent: ({ type: 'image'; source: { type: 'url'; url: string } } | { type: 'text'; text: string })[] = [];
    for (const img of imageBlocks) {
        messageContent.push(img);
    }
    messageContent.push({ type: 'text', text: visionPrompt });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_API_KEY!,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model: 'claude-sonnet-4-5-20250514',
            max_tokens: 2048,
            messages: [{ role: 'user', content: messageContent }],
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('[brand-profile] Anthropic API error:', response.status, errorText);
        throw new Error('AI vision analysis service error');
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '{}';

    let parsed: Partial<BrandProfile>;
    try {
        const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        parsed = JSON.parse(jsonStr);
    } catch {
        console.error('[brand-profile] Failed to parse response:', text);
        throw new Error('Failed to parse brand analysis');
    }

    // Step 5: Persist top reference images to Vercel Blob (IG URLs expire)
    const referenceImageUrls = await persistReferenceImages(imageMediaUrls.slice(0, 5));

    const profile: BrandProfile = {
        brandVoice: parsed.brandVoice || '',
        visualStyle: parsed.visualStyle || '',
        colorPalette: parsed.colorPalette || [],
        lightingStyle: parsed.lightingStyle || '',
        compositionNotes: parsed.compositionNotes || '',
        visualThemes: parsed.visualThemes || [],
        topTreatments: parsed.topTreatments || [],
        emojiStyle: parsed.emojiStyle || [],
        contentPillars: parsed.contentPillars || [],
        promptEnhancement: parsed.promptEnhancement || '',
        referenceImageUrls,
        generatedAt: new Date().toISOString(),
        basedOnPosts: imageBlocks.length,
    };

    await pgCacheSet(CACHE_KEY, profile, CACHE_TTL_DAYS);
    return profile;
}

export const maxDuration = 60;

export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const cached = await pgCacheGet<BrandProfile>(CACHE_KEY);
        if (cached) {
            return NextResponse.json({ profile: cached, cached: true });
        }

        // Also check old cache key for backward compat
        const oldCached = await pgCacheGet<BrandProfile>('brand_profile');
        if (oldCached) {
            return NextResponse.json({ profile: oldCached, cached: true });
        }

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
