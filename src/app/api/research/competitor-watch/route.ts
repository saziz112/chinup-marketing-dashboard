/**
 * GET /api/research/competitor-watch?location=all
 * Competitor content intelligence for the Market Intel tab.
 * Fetches competitor IG data (4h cached) and compares with our own posting data
 * to surface hashtag gaps, content treatment gaps, and engagement benchmarks.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sql } from '@vercel/postgres';
import { getIGCompetitorMetrics, type IGCompetitorMetrics } from '@/lib/integrations/meta-organic';
import type { LocationId } from '@/lib/integrations/google-business';
import { SERVICE_KEYWORDS } from '../trends/route';

export async function GET(req: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const location = (req.nextUrl.searchParams.get('location') || 'all') as LocationId | 'all';

    try {
        // Fetch competitor data + our recent posts in parallel
        const [competitorsResult, ourPostsResult] = await Promise.allSettled([
            getIGCompetitorMetrics(location === 'all' ? undefined : location as LocationId),
            sql`
                SELECT LOWER(caption) AS caption, posted_at, platform
                FROM social_posts
                WHERE posted_at > NOW() - INTERVAL '90 days'
                    AND caption IS NOT NULL
            `,
        ]);

        const competitors = competitorsResult.status === 'fulfilled' ? competitorsResult.value : [];
        const ourPosts = ourPostsResult.status === 'fulfilled' ? ourPostsResult.value.rows : [];

        // ── Extract our hashtags ──
        const ourHashtags = new Set<string>();
        for (const post of ourPosts) {
            const matches = (post.caption || '').match(/#\w+/g);
            if (matches) {
                for (const tag of matches) {
                    ourHashtags.add(tag.toLowerCase().replace('#', ''));
                }
            }
        }

        // ── Extract our treatment keywords coverage ──
        const ourCoveredKeywords = new Set<string>();
        for (const post of ourPosts) {
            const captionLower = (post.caption || '').toLowerCase();
            for (const sk of SERVICE_KEYWORDS) {
                if (captionLower.includes(sk.keyword)) {
                    ourCoveredKeywords.add(sk.keyword);
                }
            }
        }

        // ── Analyze competitor data ──
        const competitorHashtags = new Map<string, number>(); // hashtag → count of competitors using it
        const competitorKeywords = new Map<string, number>(); // service keyword → count of competitors covering it
        let totalCompetitorEngagement = 0;
        let competitorsWithEngagement = 0;

        for (const c of competitors) {
            // Aggregate hashtags
            if (c.topHashtags) {
                for (const h of c.topHashtags) {
                    const tag = h.tag.toLowerCase();
                    competitorHashtags.set(tag, (competitorHashtags.get(tag) || 0) + 1);
                }
            }

            // Aggregate treatment keyword coverage
            if (c.recentPosts) {
                for (const post of c.recentPosts) {
                    const captionLower = (post.caption || '').toLowerCase();
                    for (const sk of SERVICE_KEYWORDS) {
                        if (captionLower.includes(sk.keyword)) {
                            competitorKeywords.set(sk.keyword, (competitorKeywords.get(sk.keyword) || 0) + 1);
                        }
                    }
                }
            }

            if (c.avgEngagementRate) {
                totalCompetitorEngagement += c.avgEngagementRate;
                competitorsWithEngagement++;
            }
        }

        // ── Compute hashtag gaps (they use, we don't) ──
        const hashtagGaps = [...competitorHashtags.entries()]
            .filter(([tag]) => !ourHashtags.has(tag))
            .sort((a, b) => b[1] - a[1])
            .slice(0, 15)
            .map(([tag, count]) => ({ tag, competitorCount: count }));

        // ── Compute content gaps (treatments they cover, we haven't recently) ──
        const contentGaps = [...competitorKeywords.entries()]
            .filter(([kw]) => !ourCoveredKeywords.has(kw))
            .sort((a, b) => b[1] - a[1])
            .map(([kw, count]) => {
                const label = SERVICE_KEYWORDS.find(s => s.keyword === kw)?.label || kw;
                return { keyword: kw, label, competitorCount: count };
            });

        // ── Compute our avg engagement for comparison ──
        let ourAvgEngagement = 0;
        try {
            const ourEngResult = await sql`
                SELECT ROUND(AVG(engagement_rate)::numeric, 4) AS avg_eng
                FROM social_posts
                WHERE posted_at > NOW() - INTERVAL '90 days' AND engagement_rate IS NOT NULL
            `;
            ourAvgEngagement = Number(ourEngResult.rows[0]?.avg_eng) || 0;
        } catch { /* ignore */ }

        const competitorAvgEngagement = competitorsWithEngagement > 0
            ? totalCompetitorEngagement / competitorsWithEngagement
            : 0;

        // ── Format competitor cards ──
        const competitorCards = competitors.map((c: IGCompetitorMetrics) => ({
            username: c.username,
            followers: c.followersCount,
            mediaCount: c.mediaCount,
            avgEngagement: c.avgEngagementRate || 0,
            postingFrequency: c.postingFrequency || 0,
            engagementTrend: c.engagementTrend || 'stable',
            contentMix: c.contentMix || { images: 0, videos: 0, carousels: 0 },
            topHashtags: (c.topHashtags || []).slice(0, 5),
            viralPosts: (c.viralPosts || []).slice(0, 2).map(v => ({
                caption: v.caption.slice(0, 100),
                likeCount: v.likeCount,
                commentsCount: v.commentsCount,
                engagementRate: v.engagementRate,
                multiplier: v.multiplier,
                permalink: v.permalink,
            })),
            recentPosts: (c.recentPosts || []).slice(0, 6).map(p => ({
                caption: p.caption.slice(0, 80),
                likeCount: p.likeCount,
                commentsCount: p.commentsCount,
                mediaType: p.mediaType,
                permalink: p.permalink,
            })),
        }));

        return NextResponse.json({
            competitors: competitorCards,
            hashtagGaps,
            contentGaps,
            summary: {
                totalCompetitors: competitors.length,
                competitorAvgEngagement,
                ourAvgEngagement,
                engagementDiff: ourAvgEngagement > 0 && competitorAvgEngagement > 0
                    ? ((ourAvgEngagement - competitorAvgEngagement) / competitorAvgEngagement * 100).toFixed(1)
                    : null,
            },
        });
    } catch (error: any) {
        console.error('[research/competitor-watch] Error:', error);
        return NextResponse.json({ error: error.message || 'Competitor watch failed' }, { status: 500 });
    }
}
