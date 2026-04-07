/**
 * YouTube Data API v3 Client
 * Uses API Key (no OAuth) for public channel + video metrics.
 * Quota: 10,000 units/day. Our usage: ~5 units per refresh (channel + playlist + videos).
 */

import { trackCall } from '@/lib/api-usage-tracker';
import { createMemCache } from '@/lib/mem-cache';

// --- Types ---

export interface YTChannelInfo {
    id: string;
    title: string;
    description: string;
    customUrl: string;
    thumbnailUrl: string;
    subscriberCount: number;
    viewCount: number;
    videoCount: number;
    uploadsPlaylistId: string;
    publishedAt: string;
}

export interface YTVideo {
    id: string;
    title: string;
    description: string;
    publishedAt: string;
    thumbnailUrl: string;
    duration: string; // ISO 8601 (PT1M30S)
    durationSeconds: number;
    viewCount: number;
    likeCount: number;
    commentCount: number;
    isShort: boolean;
}

export interface YTSummary {
    subscribers: number;
    totalViews: number;
    totalVideos: number;
    recentVideoViews: number;
    recentVideoLikes: number;
    recentVideoComments: number;
    engagementRate: number;
    avgViewsPerVideo: number;
    shortsCount: number;
    longFormCount: number;
}

// --- Helpers ---

const YT_API_BASE = 'https://www.googleapis.com/youtube/v3';

function getEnv(key: string): string {
    const val = process.env[key];
    if (!val) throw new Error(`Missing env var: ${key}`);
    return val;
}

function getOptionalEnv(key: string): string | null {
    return process.env[key] || null;
}

export function isYouTubeConfigured(): boolean {
    return !!(
        getOptionalEnv('YOUTUBE_API_KEY') &&
        getOptionalEnv('YOUTUBE_CHANNEL_ID')
    );
}

async function ytGet<T>(endpoint: string): Promise<T> {
    const apiKey = getEnv('YOUTUBE_API_KEY');
    const url = `${YT_API_BASE}${endpoint}${endpoint.includes('?') ? '&' : '?'}key=${apiKey}`;
    const response = await fetch(url);
    trackCall('youtube', endpoint.split('?')[0], false);

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(
            `YouTube API error: ${response.status} ${endpoint.split('?')[0]} — ${JSON.stringify(err)}`
        );
    }

    return response.json() as Promise<T>;
}

// Parse ISO 8601 duration (PT1H2M30S) to seconds
function parseDuration(iso: string): number {
    const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;
    const hours = parseInt(match[1] || '0', 10);
    const minutes = parseInt(match[2] || '0', 10);
    const seconds = parseInt(match[3] || '0', 10);
    return hours * 3600 + minutes * 60 + seconds;
}

// --- In-Memory Cache (4-hour TTL) ---

const ytCache = createMemCache<unknown>(4 * 60 * 60 * 1000);

function getCached<T>(key: string): T | null {
    return ytCache.get(key) as T | null;
}

function setCache(key: string, data: unknown): void {
    ytCache.set(key, data);
}

// --- YouTube Data API ---

/**
 * Get channel info (snippet + statistics + contentDetails).
 * Cost: 1 unit.
 */
export async function getChannelInfo(): Promise<YTChannelInfo> {
    const cached = getCached<YTChannelInfo>('yt_channel');
    if (cached) { trackCall('youtube', 'getChannelInfo', true); return cached; }

    const channelId = getEnv('YOUTUBE_CHANNEL_ID');

    const data = await ytGet<{
        items: Array<{
            id: string;
            snippet: {
                title: string;
                description: string;
                customUrl: string;
                thumbnails: { default: { url: string }; medium?: { url: string } };
                publishedAt: string;
            };
            statistics: {
                subscriberCount: string;
                viewCount: string;
                videoCount: string;
            };
            contentDetails: {
                relatedPlaylists: { uploads: string };
            };
        }>;
    }>(`/channels?part=snippet,statistics,contentDetails&id=${channelId}`);

    if (!data.items?.length) {
        throw new Error('YouTube channel not found');
    }

    const ch = data.items[0];
    const info: YTChannelInfo = {
        id: ch.id,
        title: ch.snippet.title,
        description: ch.snippet.description || '',
        customUrl: ch.snippet.customUrl || '',
        thumbnailUrl: ch.snippet.thumbnails.medium?.url || ch.snippet.thumbnails.default.url,
        subscriberCount: parseInt(ch.statistics.subscriberCount, 10) || 0,
        viewCount: parseInt(ch.statistics.viewCount, 10) || 0,
        videoCount: parseInt(ch.statistics.videoCount, 10) || 0,
        uploadsPlaylistId: ch.contentDetails.relatedPlaylists.uploads,
        publishedAt: ch.snippet.publishedAt,
    };

    setCache('yt_channel', info);
    return info;
}

/**
 * Get recent videos with stats.
 * Cost: 1 unit (playlistItems) + 1 unit (videos) = 2 units per call.
 * Uses uploads playlist (1 unit) instead of search (100 units).
 */
export async function getRecentVideos(limit: number = 25): Promise<YTVideo[]> {
    const cacheKey = `yt_videos_${limit}`;
    const cached = getCached<YTVideo[]>(cacheKey);
    if (cached) { trackCall('youtube', 'getRecentVideos', true); return cached; }

    const channel = await getChannelInfo();
    const playlistId = channel.uploadsPlaylistId;

    // Step 1: Get video IDs from uploads playlist (cost: 1 unit)
    const playlistData = await ytGet<{
        items: Array<{
            contentDetails: { videoId: string };
            snippet: { publishedAt: string };
        }>;
    }>(`/playlistItems?part=snippet,contentDetails&playlistId=${playlistId}&maxResults=${limit}`);

    const videoIds = playlistData.items.map(item => item.contentDetails.videoId);
    if (videoIds.length === 0) {
        setCache(cacheKey, []);
        return [];
    }

    // Step 2: Get video details + stats (cost: 1 unit, up to 50 IDs per call)
    const videoData = await ytGet<{
        items: Array<{
            id: string;
            snippet: {
                title: string;
                description: string;
                publishedAt: string;
                thumbnails: { default: { url: string }; medium?: { url: string } };
            };
            contentDetails: { duration: string };
            statistics: {
                viewCount: string;
                likeCount: string;
                commentCount: string;
            };
        }>;
    }>(`/videos?part=snippet,contentDetails,statistics&id=${videoIds.join(',')}`);

    const videos: YTVideo[] = videoData.items.map(v => {
        const durationSeconds = parseDuration(v.contentDetails.duration);
        return {
            id: v.id,
            title: v.snippet.title,
            description: v.snippet.description || '',
            publishedAt: v.snippet.publishedAt,
            thumbnailUrl: v.snippet.thumbnails.medium?.url || v.snippet.thumbnails.default.url,
            duration: v.contentDetails.duration,
            durationSeconds,
            viewCount: parseInt(v.statistics.viewCount, 10) || 0,
            likeCount: parseInt(v.statistics.likeCount, 10) || 0,
            commentCount: parseInt(v.statistics.commentCount, 10) || 0,
            isShort: durationSeconds <= 60,
        };
    });

    setCache(cacheKey, videos);
    return videos;
}
