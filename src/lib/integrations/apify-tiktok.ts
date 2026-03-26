/**
 * Apify TikTok Scraper — Profile + Hashtag scraping via Apify REST API.
 * Uses clockworks/tiktok-scraper actor for reliable anti-bot handling.
 * Cost: ~$0.01/profile run, ~$0.02/hashtag run.
 */

import { trackCall } from '@/lib/api-usage-tracker';

// --- Types ---

export interface TikTokProfile {
    username: string;
    followers: number;
    following: number;
    hearts: number; // total likes
    videoCount: number;
    bio: string;
    avatarUrl: string;
    verified: boolean;
}

export interface TikTokVideo {
    id: string;
    description: string;
    views: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
    duration: number; // seconds
    musicTitle: string;
    musicAuthor: string;
    hashtags: string[];
    createTime: number; // unix timestamp
    coverUrl: string;
    videoUrl: string;
}

export interface TikTokProfileData {
    profile: TikTokProfile;
    videos: TikTokVideo[];
    scrapedAt: string;
}

export interface TikTokHashtagData {
    hashtag: string;
    videos: TikTokVideo[];
    scrapedAt: string;
}

// --- Config ---

const APIFY_BASE = 'https://api.apify.com/v2';
const ACTOR_ID = 'clockworks~tiktok-scraper'; // Most popular TikTok scraper

export function isApifyConfigured(): boolean {
    return !!process.env.APIFY_API_TOKEN;
}

function getToken(): string {
    const token = process.env.APIFY_API_TOKEN;
    if (!token) throw new Error('Missing env var: APIFY_API_TOKEN');
    return token;
}

// --- Apify API Helpers ---

interface ApifyRunResult {
    id: string;
    status: string;
    defaultDatasetId: string;
}

/**
 * Start an Apify actor run and wait for completion.
 * Polls every 5 seconds, times out after 55 seconds (within Vercel's 60s limit).
 */
async function runActor(input: Record<string, unknown>): Promise<any[]> {
    const token = getToken();
    trackCall('apify', 'runActor', false);

    // Start the actor run
    const startRes = await fetch(
        `${APIFY_BASE}/acts/${ACTOR_ID}/runs?token=${token}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
        }
    );

    if (!startRes.ok) {
        const err = await startRes.json().catch(() => ({}));
        throw new Error(`Apify start failed: ${startRes.status} — ${JSON.stringify(err)}`);
    }

    const runData: { data: ApifyRunResult } = await startRes.json();
    const runId = runData.data.id;
    const datasetId = runData.data.defaultDatasetId;

    // Poll for completion (max 55 seconds to stay within Vercel's 60s timeout)
    const startTime = Date.now();
    const TIMEOUT_MS = 55_000;
    const POLL_INTERVAL = 5_000;

    while (Date.now() - startTime < TIMEOUT_MS) {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));

        const statusRes = await fetch(
            `${APIFY_BASE}/actor-runs/${runId}?token=${token}`
        );

        if (!statusRes.ok) continue;

        const statusData: { data: { status: string } } = await statusRes.json();
        const status = statusData.data.status;

        if (status === 'SUCCEEDED') {
            // Fetch results from dataset
            const dataRes = await fetch(
                `${APIFY_BASE}/datasets/${datasetId}/items?token=${token}&format=json`
            );

            if (!dataRes.ok) throw new Error('Failed to fetch Apify dataset');
            return await dataRes.json();
        }

        if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
            throw new Error(`Apify run ${status}: ${runId}`);
        }
    }

    throw new Error(`Apify run timed out after ${TIMEOUT_MS / 1000}s`);
}

// --- Profile Scraping ---

/**
 * Scrape a TikTok user profile and their recent videos.
 */
export async function scrapeProfile(username: string): Promise<TikTokProfileData> {
    console.log(`[Apify] Scraping TikTok profile: @${username}`);

    const results = await runActor({
        profiles: [`https://www.tiktok.com/@${username}`],
        resultsPerPage: 30,
        shouldDownloadVideos: false,
        shouldDownloadCovers: false,
    });

    if (!results.length) {
        throw new Error(`No data returned for @${username}`);
    }

    // Parse profile from first result's author data
    const first = results[0];
    const authorMeta = first.authorMeta || first.author || {};

    const profile: TikTokProfile = {
        username: authorMeta.name || authorMeta.uniqueId || username,
        followers: authorMeta.fans || authorMeta.followerCount || 0,
        following: authorMeta.following || authorMeta.followingCount || 0,
        hearts: authorMeta.heart || authorMeta.heartCount || 0,
        videoCount: authorMeta.video || authorMeta.videoCount || 0,
        bio: authorMeta.signature || '',
        avatarUrl: authorMeta.avatar || authorMeta.avatarLarger || '',
        verified: authorMeta.verified || false,
    };

    // Parse videos
    const videos: TikTokVideo[] = results.map((item: any) => parseVideo(item));

    return {
        profile,
        videos,
        scrapedAt: new Date().toISOString(),
    };
}

// --- Hashtag Scraping ---

/**
 * Scrape top videos for a TikTok hashtag.
 */
export async function scrapeHashtag(hashtag: string, maxVideos: number = 20): Promise<TikTokHashtagData> {
    console.log(`[Apify] Scraping TikTok hashtag: #${hashtag}`);

    const results = await runActor({
        hashtags: [hashtag],
        resultsPerPage: maxVideos,
        shouldDownloadVideos: false,
        shouldDownloadCovers: false,
    });

    const videos: TikTokVideo[] = results.map((item: any) => parseVideo(item));

    return {
        hashtag,
        videos,
        scrapedAt: new Date().toISOString(),
    };
}

// --- Video Parser ---

function parseVideo(item: any): TikTokVideo {
    const stats = item.videoMeta || item.stats || {};
    const music = item.musicMeta || item.music || {};
    const hashtags = (item.hashtags || []).map((h: any) =>
        typeof h === 'string' ? h : (h.name || h.title || '')
    );

    return {
        id: item.id || item.videoId || '',
        description: item.text || item.desc || '',
        views: stats.playCount || stats.plays || item.playCount || 0,
        likes: stats.diggCount || stats.likes || item.diggCount || 0,
        comments: stats.commentCount || stats.comments || item.commentCount || 0,
        shares: stats.shareCount || stats.shares || item.shareCount || 0,
        saves: stats.collectCount || stats.saves || item.collectCount || 0,
        duration: stats.duration || item.videoMeta?.duration || 0,
        musicTitle: music.musicName || music.title || '',
        musicAuthor: music.musicAuthor || music.authorName || '',
        hashtags,
        createTime: item.createTime || item.createTimeISO
            ? Math.floor(new Date(item.createTimeISO || item.createTime * 1000).getTime() / 1000)
            : 0,
        coverUrl: item.covers?.default || item.video?.cover || '',
        videoUrl: item.webVideoUrl || item.videoUrl || `https://www.tiktok.com/@${item.authorMeta?.name || ''}/video/${item.id || ''}`,
    };
}
