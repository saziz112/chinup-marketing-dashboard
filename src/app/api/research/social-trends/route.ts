/**
 * GET /api/research/social-trends?source=instagram|youtube|tiktok
 * Fetch trending aesthetics content from social platforms.
 * Each source is called independently (parallel from frontend) to avoid Vercel 60s timeout.
 * Results are cached in research_social_cache (24h TTL).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sql } from '@/lib/db/sql';
import { isApifyConfigured, scrapeHashtag, type TikTokVideo } from '@/lib/integrations/apify-tiktok';

const META_PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN;
const META_IG_USER_ID = process.env.META_IG_USER_ID;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const CACHE_TTL_HOURS = 24;

// Expanded industry hashtags (6 → 12)
const IG_HASHTAGS = [
    'medspa', 'botox', 'microneedling', 'atlantamedspa', 'hydrafacial', 'fillers',
    'lipfiller', 'skincare2026', 'aestheticsnurse', 'medspatok', 'beforeandafter', 'injectables',
];

// TikTok hashtags for trend research
const TIKTOK_HASHTAGS = ['medspa', 'botox', 'lipfiller', 'microneedling', 'atlantamedspa'];

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

// --- TikTok via Apify Scraper + AI Synthesis ---

/**
 * Detect viral videos: 500K+ views OR 10%+ engagement rate, within 14 days.
 */
function detectViralVideos(videos: TikTokVideo[]): (TikTokVideo & { engagementRate: number })[] {
    const fourteenDaysAgo = Math.floor((Date.now() - 14 * 24 * 60 * 60 * 1000) / 1000);

    return videos
        .filter(v => v.createTime >= fourteenDaysAgo)
        .map(v => ({
            ...v,
            engagementRate: v.views > 0 ? (v.likes + v.comments + v.shares) / v.views : 0,
        }))
        .filter(v => v.views > 500_000 || v.engagementRate > 0.10)
        .sort((a, b) => b.views - a.views);
}

async function fetchTikTokTrends() {
    // Try Apify first for real data
    if (isApifyConfigured()) {
        try {
            console.log('[TikTok Trends] Scraping hashtags via Apify...');

            const hashtagResults: Array<{
                hashtag: string;
                videos: TikTokVideo[];
                topSounds: { title: string; author: string; count: number }[];
            }> = [];

            // Scrape hashtags sequentially (Apify runs are heavy)
            for (const hashtag of TIKTOK_HASHTAGS) {
                try {
                    const data = await scrapeHashtag(hashtag, 15);

                    // Extract top sounds from videos
                    const soundMap = new Map<string, { title: string; author: string; count: number }>();
                    for (const v of data.videos) {
                        if (!v.musicTitle) continue;
                        const key = v.musicTitle.toLowerCase();
                        const existing = soundMap.get(key) || { title: v.musicTitle, author: v.musicAuthor, count: 0 };
                        existing.count++;
                        soundMap.set(key, existing);
                    }

                    hashtagResults.push({
                        hashtag,
                        videos: data.videos,
                        topSounds: Array.from(soundMap.values()).sort((a, b) => b.count - a.count).slice(0, 3),
                    });
                } catch (e) {
                    console.error(`[TikTok Trends] Error scraping #${hashtag}:`, e);
                }
            }

            // Aggregate all videos for viral detection
            const allVideos = hashtagResults.flatMap(r => r.videos);
            const viralVideos = detectViralVideos(allVideos);

            // Aggregate top sounds across all hashtags
            const globalSoundMap = new Map<string, { title: string; author: string; count: number; totalViews: number }>();
            for (const v of allVideos) {
                if (!v.musicTitle) continue;
                const key = v.musicTitle.toLowerCase();
                const existing = globalSoundMap.get(key) || { title: v.musicTitle, author: v.musicAuthor, count: 0, totalViews: 0 };
                existing.count++;
                existing.totalViews += v.views;
                globalSoundMap.set(key, existing);
            }
            const trendingSounds = Array.from(globalSoundMap.values())
                .sort((a, b) => b.count - a.count)
                .slice(0, 8);

            // Format analysis
            const shortVideos = allVideos.filter(v => v.duration > 0 && v.duration <= 15);
            const mediumVideos = allVideos.filter(v => v.duration > 15 && v.duration <= 60);
            const longVideos = allVideos.filter(v => v.duration > 60);
            const avgViewsByLength = {
                short: shortVideos.length > 0 ? Math.round(shortVideos.reduce((s, v) => s + v.views, 0) / shortVideos.length) : 0,
                medium: mediumVideos.length > 0 ? Math.round(mediumVideos.reduce((s, v) => s + v.views, 0) / mediumVideos.length) : 0,
                long: longVideos.length > 0 ? Math.round(longVideos.reduce((s, v) => s + v.views, 0) / longVideos.length) : 0,
            };

            // AI synthesis on real data (if available)
            let aiSummary: string | null = null;
            if (ANTHROPIC_API_KEY && hashtagResults.length > 0) {
                try {
                    const dataSnapshot = hashtagResults.map(r => ({
                        hashtag: r.hashtag,
                        videoCount: r.videos.length,
                        avgViews: r.videos.length > 0 ? Math.round(r.videos.reduce((s, v) => s + v.views, 0) / r.videos.length) : 0,
                        topSounds: r.topSounds.slice(0, 2).map(s => s.title),
                        sampleCaptions: r.videos.slice(0, 3).map(v => v.description.substring(0, 80)),
                    }));

                    const response = await fetch('https://api.anthropic.com/v1/messages', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'x-api-key': ANTHROPIC_API_KEY,
                            'anthropic-version': '2023-06-01',
                        },
                        body: JSON.stringify({
                            model: 'claude-haiku-4-5-20251001',
                            max_tokens: 512,
                            messages: [{
                                role: 'user',
                                content: `Based on this real TikTok data from medspa hashtags, give a 2-3 sentence summary of what's trending and one actionable recommendation for a med spa (@chinupaesthetic) creating content:\n\n${JSON.stringify(dataSnapshot)}\n\nRespond with plain text only, no JSON.`,
                            }],
                        }),
                    });

                    if (response.ok) {
                        const data = await response.json();
                        aiSummary = data.content?.[0]?.text || null;
                    }
                } catch {
                    // AI synthesis is optional
                }
            }

            return {
                source: 'apify',
                hashtagResults: hashtagResults.map(r => ({
                    hashtag: r.hashtag,
                    videos: r.videos.map(v => ({
                        id: v.id,
                        description: v.description.substring(0, 150),
                        views: v.views,
                        likes: v.likes,
                        comments: v.comments,
                        shares: v.shares,
                        saves: v.saves,
                        duration: v.duration,
                        musicTitle: v.musicTitle,
                        musicAuthor: v.musicAuthor,
                        hashtags: v.hashtags,
                        createTime: v.createTime,
                        videoUrl: v.videoUrl,
                    })),
                    topSounds: r.topSounds,
                })),
                viralVideos: viralVideos.map(v => ({
                    id: v.id,
                    description: v.description.substring(0, 150),
                    views: v.views,
                    likes: v.likes,
                    comments: v.comments,
                    shares: v.shares,
                    engagementRate: v.engagementRate,
                    musicTitle: v.musicTitle,
                    hashtags: v.hashtags,
                    videoUrl: v.videoUrl,
                    createTime: v.createTime,
                })),
                trendingSounds,
                formatAnalysis: avgViewsByLength,
                aiSummary,
                totalVideosAnalyzed: allVideos.length,
            };
        } catch (e) {
            console.error('[TikTok Trends] Apify error, falling back to AI-only:', e);
        }
    }

    // No Apify configured — TikTok trends unavailable without real data
    return { source: 'none', summary: null, trends: [], error: 'TikTok trends require APIFY_API_TOKEN for real data.' };
}
