/**
 * Cross-Platform Repurposing Tracker
 *
 * Detects which IG posts have been repurposed to YouTube (and surfaces gaps).
 * Match heuristic:
 *   - IG video posts (Reels) compared to YT videos
 *   - Match if YT video published within ±3 days of IG post
 *   - AND share at least one of: caption similarity, hashtag, or duration proximity
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isMetaConfigured, getIGMedia } from '@/lib/integrations/meta-organic';
import { isYouTubeConfigured, getRecentVideos } from '@/lib/integrations/youtube';

const MATCH_WINDOW_DAYS = 3;
const MATCH_WINDOW_MS = MATCH_WINDOW_DAYS * 24 * 60 * 60 * 1000;

function normalize(s: string): string {
    return (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function captionSimilarity(igCaption: string, ytTitle: string): number {
    const a = normalize(igCaption);
    const b = normalize(ytTitle);
    if (!a || !b) return 0;
    // Compare first 50 chars of each, count overlapping words (length>=4)
    const aWords = new Set(a.substring(0, 80).split(' ').filter(w => w.length >= 4));
    const bWords = new Set(b.substring(0, 80).split(' ').filter(w => w.length >= 4));
    if (aWords.size === 0 || bWords.size === 0) return 0;
    let overlap = 0;
    for (const w of aWords) {
        if (bWords.has(w)) overlap++;
    }
    return overlap;
}

interface RepurposingItem {
    igPostId: string;
    igCaption: string;
    igPermalink: string;
    igTimestamp: string;
    igMediaType: string;
    igReach: number;
    igViews: number;
    igEngagementRate: number;
    isVideo: boolean;
    ytMatch: {
        videoId: string;
        title: string;
        publishedAt: string;
        viewCount: number;
        isShort: boolean;
        matchScore: number;
    } | null;
    crossPostStatus: 'cross-posted' | 'gap' | 'not-applicable'; // photos = not-applicable
}

export async function GET(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (!isMetaConfigured()) {
            return NextResponse.json({
                configured: false,
                error: 'Instagram not configured.',
            });
        }

        const [igPosts, ytVideos] = await Promise.all([
            getIGMedia(30),
            isYouTubeConfigured() ? getRecentVideos(50) : Promise.resolve([]),
        ]);

        const items: RepurposingItem[] = [];

        for (const ig of igPosts) {
            const isVideo = ig.mediaType === 'VIDEO';
            const igTime = new Date(ig.timestamp).getTime();

            let bestMatch: RepurposingItem['ytMatch'] = null;

            if (isVideo) {
                let bestScore = 0;
                for (const yt of ytVideos) {
                    const ytTime = new Date(yt.publishedAt).getTime();
                    const dt = Math.abs(igTime - ytTime);
                    if (dt > MATCH_WINDOW_MS) continue;

                    const sim = captionSimilarity(ig.caption || '', yt.title || '');
                    // Score: time proximity (closer = higher) + caption overlap
                    const proximityScore = 1 - (dt / MATCH_WINDOW_MS);
                    const score = proximityScore * 2 + sim;

                    // Require at least: same day OR 2+ matching words
                    const sameDay = dt < 24 * 60 * 60 * 1000;
                    if ((sameDay || sim >= 2) && score > bestScore) {
                        bestScore = score;
                        bestMatch = {
                            videoId: yt.id,
                            title: yt.title,
                            publishedAt: yt.publishedAt,
                            viewCount: yt.viewCount,
                            isShort: yt.isShort,
                            matchScore: Math.round(score * 100) / 100,
                        };
                    }
                }
            }

            const crossPostStatus: RepurposingItem['crossPostStatus'] = !isVideo
                ? 'not-applicable'
                : bestMatch
                    ? 'cross-posted'
                    : 'gap';

            const interactions = (ig.likeCount || 0) + (ig.commentsCount || 0) + (ig.shares || 0) + (ig.saved || 0);
            const reach = ig.reach || 0;
            const engagementRate = reach > 0 ? Math.round((interactions / reach) * 10000) / 100 : 0;

            items.push({
                igPostId: ig.id,
                igCaption: (ig.caption || '').substring(0, 150),
                igPermalink: ig.permalink,
                igTimestamp: ig.timestamp,
                igMediaType: ig.mediaType,
                igReach: reach,
                igViews: ig.views || 0,
                igEngagementRate: engagementRate,
                isVideo,
                ytMatch: bestMatch,
                crossPostStatus,
            });
        }

        // Sort: gaps first (so user sees what to act on), then cross-posted, then non-applicable
        items.sort((a, b) => {
            const order = { gap: 0, 'cross-posted': 1, 'not-applicable': 2 };
            const cmp = order[a.crossPostStatus] - order[b.crossPostStatus];
            if (cmp !== 0) return cmp;
            // Within group: newest first
            return new Date(b.igTimestamp).getTime() - new Date(a.igTimestamp).getTime();
        });

        // Stats — only count videos (not-applicable doesn't contribute to ratio)
        const videoItems = items.filter(i => i.isVideo);
        const crossPostedCount = videoItems.filter(i => i.crossPostStatus === 'cross-posted').length;
        const gapCount = videoItems.filter(i => i.crossPostStatus === 'gap').length;
        const totalVideos = videoItems.length;
        const crossPostPercent = totalVideos > 0 ? Math.round((crossPostedCount / totalVideos) * 100) : 0;

        return NextResponse.json({
            configured: true,
            items,
            stats: {
                totalIGPosts: items.length,
                totalVideos,
                crossPostedCount,
                gapCount,
                crossPostPercent,
                ytConfigured: isYouTubeConfigured(),
            },
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Repurposing API error:', message);
        return NextResponse.json({ configured: true, error: message }, { status: 500 });
    }
}
