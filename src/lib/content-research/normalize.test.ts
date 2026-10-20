import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    normalizeInstagramReels, normalizeTikTokItems, normalizeYouTubeVideos,
    parseIsoDuration, vttToText, tiktokSubtitleUrl,
} from './normalize';

// Sample payloads shaped after the actors' documented output (not live recordings).
const fx = (name: string) => readFileSync(join(__dirname, '__fixtures__', name), 'utf8');
const igItems = JSON.parse(fx('apify-instagram-reels.json'));
const ttItems = JSON.parse(fx('apify-tiktok.json'));
const ytBody = JSON.parse(fx('youtube-videos.json'));

describe('normalizeInstagramReels', () => {
    const out = normalizeInstagramReels(igItems);

    it('drops error rows and keeps every reel', () => {
        expect(out.videos.map(v => v.externalId)).toEqual(['DAbc123XyZ', 'DAdef456', 'DAnoviews']);
        expect(out.errors).toEqual([{ input: 'https://www.instagram.com/privateaccount', message: 'Profile does not exist or is private' }]);
    });

    it('prefers plays over views (what Instagram shows on reels) and lowercases the owner', () => {
        expect(out.videos[0]).toMatchObject({
            platform: 'instagram', accountHandle: 'exampleinjector', views: 251000, likes: 8450, comments: 212,
            durationSec: 15, postedAt: '2026-09-30T17:02:11.000Z', url: 'https://www.instagram.com/reel/DAbc123XyZ/',
        });
        expect(out.videos[1].accountHandle).toBe('exampleinjector');
    });

    it('treats hidden counts as unknown, not zero', () => {
        expect(out.videos[1].likes).toBeNull();
        expect(out.videos[2].views).toBeNull();
    });

    it('keeps a transcript when the actor returned one', () => {
        expect(out.videos[1].transcript).toBe('So this is day one. A little swelling is normal.');
        expect(out.videos[0].transcript).toBeNull();
    });
});

describe('normalizeTikTokItems', () => {
    const out = normalizeTikTokItems(ttItems);

    it('maps TikTok fields and records profile errors', () => {
        expect(out.videos).toHaveLength(2);
        expect(out.videos[0]).toMatchObject({
            platform: 'tiktok', externalId: '7421234567890123456', accountHandle: 'exampleinjector',
            views: 412000, likes: 15200, comments: 310, shares: 820, durationSec: 31,
            postedAt: '2026-10-02T20:13:20.000Z', thumbnailUrl: 'https://p16-sign.tiktokcdn.com/cover1.jpeg',
        });
        expect(out.errors).toHaveLength(1);
    });

    it('finds the English subtitle link', () => {
        expect(tiktokSubtitleUrl(ttItems[0])).toBe('https://v16-webapp.tiktok.com/sub1.vtt');
        expect(tiktokSubtitleUrl(ttItems[1])).toBeNull();
    });
});

describe('normalizeYouTubeVideos', () => {
    const vids = normalizeYouTubeVideos(ytBody.items, 'exampleDerm');

    it('keeps Shorts-length videos only (3 minutes or less)', () => {
        expect(vids.map(v => v.externalId)).toEqual(['abcDEF12345', 'hiddenStats1']);
    });

    it('parses string counts and builds a Shorts URL', () => {
        expect(vids[0]).toMatchObject({
            views: 1500000, likes: 42000, comments: 900, durationSec: 32, accountHandle: 'examplederm',
            url: 'https://www.youtube.com/shorts/abcDEF12345', caption: 'Botox in 30 seconds #shorts\n\nWhat 20 units does.',
        });
        expect(vids[1].views).toBeNull();
    });
});

describe('parseIsoDuration', () => {
    it('reads ISO 8601 durations', () => {
        expect(parseIsoDuration('PT32S')).toBe(32);
        expect(parseIsoDuration('PT1M5S')).toBe(65);
        expect(parseIsoDuration('PT1H2M')).toBe(3720);
        expect(parseIsoDuration('garbage')).toBeNull();
    });
});

describe('vttToText', () => {
    it('strips headers, timings, cue numbers, tags and repeated lines', () => {
        expect(vttToText(fx('tiktok-subtitles.vtt'))).toBe(
            "So you want to know what $650 of Dysport gets you? Sixty units. That's about two areas.",
        );
    });
});
