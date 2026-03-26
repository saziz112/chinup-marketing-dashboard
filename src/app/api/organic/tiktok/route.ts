import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sql } from '@vercel/postgres';
import {
    isApifyConfigured,
    scrapeProfile,
    type TikTokProfileData,
    type TikTokVideo,
} from '@/lib/integrations/apify-tiktok';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// --- Postgres cache helpers ---

async function ensureTikTokCacheTable() {
    await sql`
        CREATE TABLE IF NOT EXISTS tiktok_metrics_cache (
            cache_key VARCHAR(100) PRIMARY KEY,
            username VARCHAR(100) NOT NULL,
            cache_data JSONB NOT NULL,
            expires_at TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `;
}

async function getCachedProfile(username: string): Promise<TikTokProfileData | null> {
    try {
        await ensureTikTokCacheTable();
        const result = await sql`
            SELECT cache_data FROM tiktok_metrics_cache
            WHERE cache_key = ${'profile_' + username}
            AND expires_at > NOW()
        `;
        if (result.rows.length > 0) {
            return result.rows[0].cache_data as TikTokProfileData;
        }
    } catch (e) {
        console.warn('[TikTok] Cache read error:', e);
    }
    return null;
}

async function setCachedProfile(username: string, data: TikTokProfileData): Promise<void> {
    try {
        await ensureTikTokCacheTable();
        const expiresAt = new Date(Date.now() + CACHE_TTL_MS).toISOString();
        await sql`
            INSERT INTO tiktok_metrics_cache (cache_key, username, cache_data, expires_at)
            VALUES (${'profile_' + username}, ${username}, ${JSON.stringify(data)}, ${expiresAt})
            ON CONFLICT (cache_key) DO UPDATE SET
                cache_data = ${JSON.stringify(data)},
                expires_at = ${expiresAt},
                created_at = NOW()
        `;
    } catch (e) {
        console.warn('[TikTok] Cache write error:', e);
    }
}

// --- Computed metrics ---

interface TikTokSummary {
    followers: number;
    following: number;
    totalLikes: number;
    videoCount: number;
    bio: string;
    avatarUrl: string;
    verified: boolean;
    avgViews: number;
    avgLikes: number;
    avgComments: number;
    avgShares: number;
    avgSaves: number;
    engagementRate: number;
    postingCadence: number; // posts per week
    topSounds: { title: string; author: string; count: number; avgViews: number }[];
    topHashtags: { tag: string; count: number; avgViews: number }[];
    breakoutVideos: (TikTokVideo & { viewMultiplier: number; engMultiplier: number })[];
    savesRate: number;
}

function computeSummary(data: TikTokProfileData, days: number): TikTokSummary {
    const { profile, videos } = data;

    // Filter videos by period
    const cutoffTs = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
    const periodVideos = videos.filter(v => v.createTime >= cutoffTs);
    const vids = periodVideos.length > 0 ? periodVideos : videos;

    // Averages
    const avgViews = vids.length > 0 ? vids.reduce((s, v) => s + v.views, 0) / vids.length : 0;
    const avgLikes = vids.length > 0 ? vids.reduce((s, v) => s + v.likes, 0) / vids.length : 0;
    const avgComments = vids.length > 0 ? vids.reduce((s, v) => s + v.comments, 0) / vids.length : 0;
    const avgShares = vids.length > 0 ? vids.reduce((s, v) => s + v.shares, 0) / vids.length : 0;
    const avgSaves = vids.length > 0 ? vids.reduce((s, v) => s + v.saves, 0) / vids.length : 0;

    // Engagement rate: (likes + comments + shares) / views
    const totalEngagement = vids.reduce((s, v) => s + v.likes + v.comments + v.shares, 0);
    const totalViews = vids.reduce((s, v) => s + v.views, 0);
    const engagementRate = totalViews > 0 ? totalEngagement / totalViews : 0;

    // Saves rate
    const totalSaves = vids.reduce((s, v) => s + v.saves, 0);
    const savesRate = totalViews > 0 ? totalSaves / totalViews : 0;

    // Posting cadence
    const timestamps = vids.map(v => v.createTime).sort((a, b) => a - b);
    const spanDays = timestamps.length > 1
        ? (timestamps[timestamps.length - 1] - timestamps[0]) / (60 * 60 * 24)
        : 7;
    const postingCadence = spanDays > 0 ? (vids.length / spanDays) * 7 : vids.length;

    // Top sounds
    const soundMap = new Map<string, { title: string; author: string; count: number; totalViews: number }>();
    for (const v of vids) {
        if (!v.musicTitle) continue;
        const key = v.musicTitle.toLowerCase();
        const existing = soundMap.get(key) || { title: v.musicTitle, author: v.musicAuthor, count: 0, totalViews: 0 };
        existing.count++;
        existing.totalViews += v.views;
        soundMap.set(key, existing);
    }
    const topSounds = Array.from(soundMap.values())
        .map(s => ({ ...s, avgViews: Math.round(s.totalViews / s.count) }))
        .sort((a, b) => b.avgViews - a.avgViews)
        .slice(0, 5);

    // Top hashtags
    const hashtagMap = new Map<string, { count: number; totalViews: number }>();
    for (const v of vids) {
        for (const tag of v.hashtags) {
            const lower = tag.toLowerCase();
            const existing = hashtagMap.get(lower) || { count: 0, totalViews: 0 };
            existing.count++;
            existing.totalViews += v.views;
            hashtagMap.set(lower, existing);
        }
    }
    const topHashtags = Array.from(hashtagMap.entries())
        .map(([tag, data]) => ({ tag: `#${tag}`, count: data.count, avgViews: Math.round(data.totalViews / data.count) }))
        .sort((a, b) => b.avgViews - a.avgViews)
        .slice(0, 10);

    // Breakout videos: views > 3x avg AND engagement rate > 2x avg
    const avgEngPerVideo = vids.length > 0
        ? vids.reduce((s, v) => s + (v.views > 0 ? (v.likes + v.comments + v.shares) / v.views : 0), 0) / vids.length
        : 0;
    const breakoutVideos = vids
        .filter(v => v.views > avgViews * 3 || (v.views > 0 && (v.likes + v.comments + v.shares) / v.views > avgEngPerVideo * 2))
        .map(v => ({
            ...v,
            viewMultiplier: avgViews > 0 ? Math.round((v.views / avgViews) * 10) / 10 : 0,
            engMultiplier: avgEngPerVideo > 0 && v.views > 0
                ? Math.round(((v.likes + v.comments + v.shares) / v.views / avgEngPerVideo) * 10) / 10
                : 0,
        }))
        .sort((a, b) => b.viewMultiplier - a.viewMultiplier)
        .slice(0, 5);

    return {
        followers: profile.followers,
        following: profile.following,
        totalLikes: profile.hearts,
        videoCount: profile.videoCount,
        bio: profile.bio,
        avatarUrl: profile.avatarUrl,
        verified: profile.verified,
        avgViews: Math.round(avgViews),
        avgLikes: Math.round(avgLikes),
        avgComments: Math.round(avgComments),
        avgShares: Math.round(avgShares),
        avgSaves: Math.round(avgSaves),
        engagementRate,
        postingCadence: Math.round(postingCadence * 10) / 10,
        topSounds,
        topHashtags,
        breakoutVideos,
        savesRate,
    };
}

// --- Route Handler ---

export async function GET(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (!isApifyConfigured()) {
            return NextResponse.json({
                configured: false,
                error: 'TikTok not connected. Add APIFY_API_TOKEN and TIKTOK_USERNAME to environment variables.',
            }, { status: 200 });
        }

        const username = process.env.TIKTOK_USERNAME;
        if (!username) {
            return NextResponse.json({
                configured: false,
                error: 'TIKTOK_USERNAME not set in environment variables.',
            }, { status: 200 });
        }

        const searchParams = request.nextUrl.searchParams;
        const periodParam = searchParams.get('period') || '30d';
        const days = periodParam === '7d' ? 7 : periodParam === '90d' ? 90 : 30;

        // Check cache first
        let profileData = await getCachedProfile(username);

        if (!profileData) {
            // Scrape from Apify
            profileData = await scrapeProfile(username);
            await setCachedProfile(username, profileData);
        }

        const summary = computeSummary(profileData, days);

        // Filter videos by period for the response
        const cutoffTs = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
        const periodVideos = profileData.videos
            .filter(v => v.createTime >= cutoffTs)
            .sort((a, b) => b.createTime - a.createTime);

        return NextResponse.json({
            configured: true,
            profile: {
                username: profileData.profile.username,
                followers: profileData.profile.followers,
                following: profileData.profile.following,
                hearts: profileData.profile.hearts,
                videoCount: profileData.profile.videoCount,
                bio: profileData.profile.bio,
                avatarUrl: profileData.profile.avatarUrl,
                verified: profileData.profile.verified,
            },
            summary,
            videos: periodVideos,
            scrapedAt: profileData.scrapedAt,
        });
    } catch (error) {
        console.error('[TikTok] Error fetching organic data:', error);
        return NextResponse.json(
            { error: 'Failed to fetch TikTok data', configured: true },
            { status: 500 }
        );
    }
}
