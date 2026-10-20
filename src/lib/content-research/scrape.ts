/**
 * Fetch recent short-form videos for watchlist accounts.
 * Instagram + TikTok go through Apify (paid per result, one batched run per
 * platform). YouTube Shorts go through the YouTube Data API (free quota).
 */

import { runApifyActor, isApifyConfigured } from '@/lib/integrations/apify-tiktok';
import { trackCall } from '@/lib/api-usage-tracker';
import {
    normalizeInstagramReels, normalizeTikTokItems, normalizeYouTubeVideos, tiktokSubtitleUrl, vttToText,
    type NormalizeResult, type ScrapedVideo,
} from './normalize';
import type { Platform } from './watchlist';

export const IG_REEL_ACTOR = 'apify~instagram-reel-scraper';
export const TIKTOK_ACTOR = 'clockworks~tiktok-scraper';

const YT_BASE = 'https://www.googleapis.com/youtube/v3';

export function researchConfig() {
    return {
        apify: isApifyConfigured(),
        youtube: !!process.env.YOUTUBE_API_KEY,
        anthropic: !!process.env.ANTHROPIC_API_KEY,
    };
}

export function isPlatformConfigured(platform: Platform): boolean {
    const c = researchConfig();
    return platform === 'youtube' ? c.youtube : c.apify;
}

/** One Apify run for all Instagram handles. `resultsLimit` is per profile. */
export async function scrapeInstagramReels(handles: string[], perAccount: number, timeoutMs: number): Promise<NormalizeResult> {
    if (handles.length === 0) return { videos: [], errors: [] };
    const items = await runApifyActor(IG_REEL_ACTOR, {
        username: handles,
        resultsLimit: perAccount,
        skipPinnedPosts: true,
        includeTranscript: false,
    }, { timeoutMs });
    return normalizeInstagramReels(items);
}

/** One Apify run for all TikTok handles, newest videos first. */
export async function scrapeTikTokProfiles(handles: string[], perAccount: number, timeoutMs: number): Promise<NormalizeResult> {
    if (handles.length === 0) return { videos: [], errors: [] };
    const items = await runApifyActor(TIKTOK_ACTOR, {
        profiles: handles,
        resultsPerPage: perAccount,
        profileSorting: 'latest',
        excludePinnedPosts: true,
        shouldDownloadVideos: false,
        shouldDownloadCovers: false,
        shouldDownloadSubtitles: false,
    }, { timeoutMs });
    return normalizeTikTokItems(items);
}

/** Latest Shorts (≤ 3 min) from a channel's uploads, via the free Data API. */
export async function fetchYouTubeShorts(handle: string, maxUploads = 30): Promise<ScrapedVideo[]> {
    const key = process.env.YOUTUBE_API_KEY;
    if (!key) throw new Error('YOUTUBE_API_KEY is not set');
    trackCall('youtube', 'contentResearchShorts', false);

    const lookup = /^UC[A-Za-z0-9_-]{6,}$/.test(handle) ? `id=${handle}` : `forHandle=${encodeURIComponent('@' + handle)}`;
    const ch = await ytGet(`${YT_BASE}/channels?part=contentDetails&${lookup}&key=${key}`);
    const uploads = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploads) throw new Error(`YouTube channel not found: @${handle}`);

    const pl = await ytGet(`${YT_BASE}/playlistItems?part=contentDetails&maxResults=${Math.min(maxUploads, 50)}&playlistId=${uploads}&key=${key}`);
    const ids: string[] = (pl.items || []).map((i: { contentDetails?: { videoId?: string } }) => i.contentDetails?.videoId).filter(Boolean);
    if (ids.length === 0) return [];

    const vids = await ytGet(`${YT_BASE}/videos?part=snippet,contentDetails,statistics&id=${ids.join(',')}&key=${key}`);
    return normalizeYouTubeVideos(vids.items || [], handle);
}

async function ytGet(url: string) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`YouTube API ${res.status}`);
    return res.json();
}

/**
 * Transcript for one video, paid once and then stored.
 * Instagram: reel scraper's transcript add-on (~$0.05 per minute of video).
 * TikTok: the creator/auto captions TikTok already hosts, as a VTT file.
 * YouTube: no free route, returns null.
 */
export async function fetchTranscript(platform: Platform, url: string): Promise<{ text: string | null; source: string }> {
    if (platform === 'instagram') {
        const items = await runApifyActor(IG_REEL_ACTOR, { username: [url], resultsLimit: 1, includeTranscript: true }, { timeoutMs: 120_000 });
        const reel = normalizeInstagramReels(items).videos[0];
        return { text: reel?.transcript ?? null, source: 'apify_ig_transcript' };
    }
    if (platform === 'tiktok') {
        const items = await runApifyActor(TIKTOK_ACTOR, { postURLs: [url], shouldDownloadSubtitles: true, shouldDownloadVideos: false, shouldDownloadCovers: false }, { timeoutMs: 120_000 });
        const subUrl = items[0] ? tiktokSubtitleUrl(items[0]) : null;
        if (!subUrl) return { text: null, source: 'tiktok_captions' };
        const res = await fetch(subUrl);
        if (!res.ok) return { text: null, source: 'tiktok_captions' };
        const text = vttToText(await res.text());
        return { text: text || null, source: 'tiktok_captions' };
    }
    return { text: null, source: 'none' };
}
