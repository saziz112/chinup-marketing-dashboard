/**
 * GET /api/research/social-trends?source=instagram|youtube|tiktok
 * Fetch trending aesthetics content from social platforms.
 * Each source is called independently (parallel from frontend) to avoid Vercel 60s timeout.
 * Results are cached in research_social_cache (24h TTL).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sql } from '@vercel/postgres';

const META_PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN;
const META_IG_USER_ID = process.env.META_IG_USER_ID;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const CACHE_TTL_HOURS = 24;

// Industry hashtags to search on IG
const IG_HASHTAGS = ['medspa', 'botox', 'microneedling', 'atlantamedspa', 'hydrafacial', 'fillers'];

// YouTube search queries for aesthetics trends
const YT_QUERIES = ['med spa treatments 2026', 'botox before and after', 'microneedling results'];

export async function GET(req: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const source = req.nextUrl.searchParams.get('source');
    if (!source || !['instagram', 'youtube', 'tiktok'].includes(source)) {
        return NextResponse.json({ error: 'source param required: instagram, youtube, or tiktok' }, { status: 400 });
    }

    try {
        // Check cache first
        const cached = await getCachedResult(source);
        if (cached) {
            return NextResponse.json(cached);
        }

        let result: any;

        switch (source) {
            case 'instagram':
                result = await fetchInstagramTrends();
                break;
            case 'youtube':
                result = await fetchYouTubeTrends();
                break;
            case 'tiktok':
                result = await fetchTikTokTrends();
                break;
        }

        // Cache the result
        if (result) {
            await cacheResult(source, result);
        }

        // Track usage
        const monthKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
        await sql`
            INSERT INTO api_usage_monthly (api_name, month_key, total_calls)
            VALUES (${'research_social_' + source}, ${monthKey}, 1)
            ON CONFLICT (api_name, month_key)
            DO UPDATE SET total_calls = api_usage_monthly.total_calls + 1
        `.catch(() => {});

        return NextResponse.json(result || { results: [] });
    } catch (error: any) {
        console.error(`[research/social-trends/${source}] Error:`, error);
        return NextResponse.json({ error: error.message || `Failed to fetch ${source} trends` }, { status: 500 });
    }
}

// --- Cache helpers ---

async function getCachedResult(source: string): Promise<any | null> {
    try {
        const { rows } = await sql`
            SELECT cache_data FROM research_social_cache
            WHERE cache_key = ${'social_trends_' + source}
            AND expires_at > NOW()
            LIMIT 1
        `;
        if (rows.length > 0) {
            return rows[0].cache_data;
        }
    } catch {
        // Table might not exist yet
    }
    return null;
}

async function cacheResult(source: string, data: any) {
    try {
        await sql`
            INSERT INTO research_social_cache (cache_key, source, cache_data, expires_at)
            VALUES (${'social_trends_' + source}, ${source}, ${JSON.stringify(data)}, NOW() + INTERVAL '24 hours')
            ON CONFLICT (cache_key) DO UPDATE SET
                cache_data = EXCLUDED.cache_data,
                expires_at = EXCLUDED.expires_at,
                created_at = NOW()
        `;
    } catch (e) {
        console.error('[research/social-trends] Cache write error:', e);
    }
}

// --- Instagram Hashtag Search ---

async function fetchInstagramTrends() {
    if (!META_PAGE_ACCESS_TOKEN || !META_IG_USER_ID) {
        return { results: [], error: 'Instagram not configured' };
    }

    const results: Array<{ hashtag: string; posts: any[] }> = [];

    for (const hashtag of IG_HASHTAGS) {
        try {
            // Step 1: Search for hashtag ID
            const searchRes = await fetch(
                `https://graph.facebook.com/v21.0/ig_hashtag_search?q=${hashtag}&user_id=${META_IG_USER_ID}&access_token=${META_PAGE_ACCESS_TOKEN}`
            );
            const searchData = await searchRes.json();
            const hashtagId = searchData?.data?.[0]?.id;
            if (!hashtagId) continue;

            // Step 2: Get top media for this hashtag
            const mediaRes = await fetch(
                `https://graph.facebook.com/v21.0/${hashtagId}/top_media?user_id=${META_IG_USER_ID}&fields=id,caption,like_count,comments_count,media_type,permalink,timestamp&limit=5&access_token=${META_PAGE_ACCESS_TOKEN}`
            );
            const mediaData = await mediaRes.json();
            const posts = (mediaData?.data || []).map((p: any) => ({
                id: p.id,
                caption: (p.caption || '').slice(0, 200),
                likeCount: p.like_count || 0,
                commentsCount: p.comments_count || 0,
                mediaType: p.media_type,
                permalink: p.permalink,
                timestamp: p.timestamp,
            }));

            results.push({ hashtag, posts });
        } catch (e) {
            console.error(`[IG hashtag] Error searching #${hashtag}:`, e);
        }
    }

    return { results };
}

// --- YouTube Search ---

async function fetchYouTubeTrends() {
    if (!YOUTUBE_API_KEY) {
        return { results: [], error: 'YouTube not configured' };
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const publishedAfter = thirtyDaysAgo.toISOString();

    const results: Array<{ query: string; videos: any[] }> = [];

    for (const query of YT_QUERIES) {
        try {
            const searchRes = await fetch(
                `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&order=viewCount&publishedAfter=${publishedAfter}&maxResults=5&key=${YOUTUBE_API_KEY}`
            );
            const searchData = await searchRes.json();

            if (!searchData.items?.length) continue;

            // Get video statistics
            const videoIds = searchData.items.map((v: any) => v.id.videoId).join(',');
            const statsRes = await fetch(
                `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${videoIds}&key=${YOUTUBE_API_KEY}`
            );
            const statsData = await statsRes.json();
            const statsMap: Record<string, any> = {};
            for (const v of (statsData.items || [])) {
                statsMap[v.id] = v.statistics;
            }

            const videos = searchData.items.map((v: any) => ({
                id: v.id.videoId,
                title: v.snippet.title,
                channelTitle: v.snippet.channelTitle,
                publishedAt: v.snippet.publishedAt,
                thumbnailUrl: v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url,
                viewCount: Number(statsMap[v.id.videoId]?.viewCount || 0),
                likeCount: Number(statsMap[v.id.videoId]?.likeCount || 0),
            }));

            results.push({ query, videos });
        } catch (e) {
            console.error(`[YT search] Error for "${query}":`, e);
        }
    }

    return { results };
}

// --- TikTok via Claude AI Web Search ---

async function fetchTikTokTrends() {
    if (!ANTHROPIC_API_KEY) {
        return { summary: null, trends: [], error: 'AI service not configured' };
    }

    const prompt = `Search the web for current trending TikTok content in the medical aesthetics / med spa industry (March-April 2026).

I need:
1. A brief summary (2-3 sentences) of what's currently trending on TikTok in the aesthetics/med spa space
2. A list of 8-10 specific trending topics, formats, or content styles

For each trend, provide:
- title: Short trend name
- description: 1-2 sentences explaining the trend and why it's popular

Focus on:
- Trending sounds or formats being used by med spas
- Popular treatment showcases (Botox, fillers, microneedling, etc.)
- Before/after content styles that get high engagement
- Educational content that goes viral
- Influencer/creator trends in the beauty/aesthetics space

Return ONLY valid JSON: {"summary":"...","trends":[{"title":"...","description":"..."}]}
No markdown, no code fences.`;

    try {
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
            console.error('[TikTok AI] API error:', response.status);
            return { summary: null, trends: [], error: 'AI service error' };
        }

        const data = await response.json();
        const text = data.content?.[0]?.text || '{}';
        const cleaned = text.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim();
        const parsed = JSON.parse(cleaned);

        return {
            summary: parsed.summary || null,
            trends: parsed.trends || [],
        };
    } catch (e) {
        console.error('[TikTok AI] Error:', e);
        return { summary: null, trends: [], error: 'Failed to analyze TikTok trends' };
    }
}
