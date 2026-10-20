/**
 * Turn Apify (Instagram reels, TikTok) and YouTube Data API payloads into one
 * video shape. Missing or hidden counts become null, never 0, so they can't
 * drag an account's median down.
 */

import type { Platform } from './watchlist';

export interface ScrapedVideo {
    platform: Platform;
    externalId: string;
    accountHandle: string;
    url: string;
    caption: string;
    views: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    durationSec: number | null;
    postedAt: string | null;
    thumbnailUrl: string | null;
    transcript: string | null;
}

export interface NormalizeResult {
    videos: ScrapedVideo[];
    errors: { input: string; message: string }[];
}

/** YouTube counts a video as a Short up to 3 minutes. */
export const SHORTS_MAX_SECONDS = 180;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;

function count(v: unknown): number | null {
    const n = typeof v === 'string' ? Number(v) : v;
    return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
}

function iso(v: unknown): string | null {
    if (typeof v !== 'string' && typeof v !== 'number') return null;
    const d = new Date(typeof v === 'number' ? v * 1000 : v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function errorRow(item: Raw): { input: string; message: string } | null {
    if (!item.error) return null;
    return { input: String(item.inputUrl || item.url || item.input || ''), message: String(item.errorDescription || item.error) };
}

export function normalizeInstagramReels(items: Raw[]): NormalizeResult {
    const out: NormalizeResult = { videos: [], errors: [] };
    for (const item of items) {
        const err = errorRow(item);
        if (err) { out.errors.push(err); continue; }
        const shortCode = item.shortCode || item.code;
        if (!shortCode || !item.ownerUsername) continue;
        const duration = count(item.videoDuration);
        out.videos.push({
            platform: 'instagram',
            externalId: String(shortCode),
            accountHandle: String(item.ownerUsername).toLowerCase(),
            url: `https://www.instagram.com/reel/${shortCode}/`,
            caption: item.caption || '',
            // Reels show plays on the profile grid; videoViewCount is the older, smaller metric.
            views: count(item.videoPlayCount) ?? count(item.videoViewCount) ?? count(item.playsCount),
            likes: count(item.likesCount),
            comments: count(item.commentsCount),
            shares: count(item.sharesCount),
            durationSec: duration === null ? null : Math.round(duration),
            postedAt: iso(item.timestamp),
            thumbnailUrl: item.displayUrl || null,
            transcript: typeof item.transcript === 'string' && item.transcript.trim() ? item.transcript.trim() : null,
        });
    }
    return out;
}

export function normalizeTikTokItems(items: Raw[]): NormalizeResult {
    const out: NormalizeResult = { videos: [], errors: [] };
    for (const item of items) {
        const err = errorRow(item);
        if (err) { out.errors.push(err); continue; }
        const handle = item.authorMeta?.name || item.author?.uniqueId;
        if (!item.id || !handle) continue;
        out.videos.push({
            platform: 'tiktok',
            externalId: String(item.id),
            accountHandle: String(handle).toLowerCase(),
            url: item.webVideoUrl || `https://www.tiktok.com/@${handle}/video/${item.id}`,
            caption: item.text || '',
            views: count(item.playCount ?? item.stats?.playCount),
            likes: count(item.diggCount ?? item.stats?.diggCount),
            comments: count(item.commentCount ?? item.stats?.commentCount),
            shares: count(item.shareCount ?? item.stats?.shareCount),
            durationSec: count(item.videoMeta?.duration),
            postedAt: iso(item.createTimeISO ?? item.createTime),
            thumbnailUrl: item.videoMeta?.coverUrl || null,
            transcript: null,
        });
    }
    return out;
}

/** English subtitle file TikTok attached to the video, if any. */
export function tiktokSubtitleUrl(item: Raw): string | null {
    const links: Raw[] = item.videoMeta?.subtitleLinks || [];
    const en = links.find(l => /^en/i.test(l.language || '')) || links[0];
    return en?.downloadLink || null;
}

export function parseIsoDuration(d: string): number | null {
    const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d || '');
    if (!m || (!m[1] && !m[2] && !m[3])) return null;
    return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
}

export function normalizeYouTubeVideos(items: Raw[], channelHandle: string): ScrapedVideo[] {
    const out: ScrapedVideo[] = [];
    for (const item of items) {
        const duration = parseIsoDuration(item.contentDetails?.duration);
        if (!item.id || duration === null || duration > SHORTS_MAX_SECONDS) continue;
        const s = item.snippet || {};
        const thumbs = s.thumbnails || {};
        out.push({
            platform: 'youtube',
            externalId: String(item.id),
            accountHandle: channelHandle.toLowerCase(),
            url: `https://www.youtube.com/shorts/${item.id}`,
            caption: [s.title, s.description].filter(Boolean).join('\n\n'),
            views: count(item.statistics?.viewCount),
            likes: count(item.statistics?.likeCount),
            comments: count(item.statistics?.commentCount),
            shares: null,
            durationSec: duration,
            postedAt: iso(s.publishedAt),
            thumbnailUrl: (thumbs.high || thumbs.medium || thumbs.default)?.url || null,
            transcript: null,
        });
    }
    return out;
}

export function vttToText(vtt: string): string {
    const lines: string[] = [];
    for (const raw of vtt.split(/\r?\n/)) {
        const line = raw.replace(/<[^>]+>/g, '').trim();
        if (!line || line === 'WEBVTT' || /^\d+$/.test(line) || line.includes('-->') || /^(NOTE|STYLE|Kind:|Language:)/.test(line)) continue;
        if (lines[lines.length - 1] === line) continue;
        lines.push(line);
    }
    return lines.join(' ');
}
