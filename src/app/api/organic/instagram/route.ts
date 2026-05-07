import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { subDays, format } from 'date-fns';
import {
    isMetaConfigured,
    getIGProfile,
    getIGInsights,
    getIGMedia,
    getIGPeriodTotals,
    getIGStories,
} from '@/lib/integrations/meta-organic';
import { generateAICoachingPlan } from '@/lib/ig-coaching-ai';

export async function GET(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (!isMetaConfigured()) {
            return NextResponse.json({
                configured: false,
                error: 'Instagram not connected. Add META_PAGE_ACCESS_TOKEN and META_IG_USER_ID to .env.local',
            }, { status: 200 });
        }

        const searchParams = request.nextUrl.searchParams;
        const periodParam = searchParams.get('period') || '30d';
        const days = periodParam === '7d' ? 7 : periodParam === '90d' ? 90 : 30;
        const mediaLimit = days <= 7 ? 7 : days <= 30 ? 15 : 30;

        // IG follower_count only supports since within 30 days of today
        const endDate = new Date();
        const startDate = subDays(endDate, days - 1);
        const since = format(startDate, 'yyyy-MM-dd');
        const until = format(endDate, 'yyyy-MM-dd');

        // Prior period (same window length, shifted back by `days`)
        const priorEndDate = subDays(startDate, 1);
        const priorStartDate = subDays(priorEndDate, days - 1);
        const priorSince = format(priorStartDate, 'yyyy-MM-dd');
        const priorUntil = format(priorEndDate, 'yyyy-MM-dd');

        // Fetch profile, insights, prior-period totals, recent posts, and active stories in parallel
        const [profile, insights, priorTotals, posts, stories] = await Promise.all([
            getIGProfile(),
            getIGInsights(since, until),
            getIGPeriodTotals(priorSince, priorUntil),
            getIGMedia(mediaLimit),
            getIGStories(),
        ]);

        const { daily, totals } = insights;

        // Compute reach total + follower change from daily data
        const totalReach = daily.reduce((sum, d) => sum + d.reach, 0);
        const netFollowerChange = daily.reduce((sum, d) => sum + d.followerCount, 0);

        // Aggregate comment-reply stats across all fetched posts
        const replyAggregate = posts.reduce(
            (acc, p) => {
                acc.totalComments += p.commentsFetched || 0;
                acc.replied += p.commentsReplied || 0;
                if (p.avgReplyHours !== null && p.avgReplyHours !== undefined) {
                    acc.replyHourSamples.push(p.avgReplyHours);
                }
                return acc;
            },
            { totalComments: 0, replied: 0, replyHourSamples: [] as number[] },
        );

        // Build flat unreplied-comments inbox (across all posts), newest first
        const unrepliedInbox = posts.flatMap(p =>
            (p.unrepliedComments || []).map(c => ({
                commentId: c.id,
                text: c.text,
                username: c.username,
                timestamp: c.timestamp,
                postId: p.id,
                postCaption: (p.caption || '').substring(0, 100),
                postMediaType: p.mediaType,
                postPermalink: p.permalink,
                postTimestamp: p.timestamp,
            })),
        ).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        const replyRate = replyAggregate.totalComments > 0
            ? Math.round((replyAggregate.replied / replyAggregate.totalComments) * 10000) / 100
            : 0;
        const avgResponseHours = replyAggregate.replyHourSamples.length > 0
            ? Math.round(
                (replyAggregate.replyHourSamples.reduce((a, b) => a + b, 0) /
                    replyAggregate.replyHourSamples.length) * 100,
            ) / 100
            : null;

        // Engagement rate = total interactions / total reach * 100
        const engagementRate = totalReach > 0
            ? Math.round((totals.totalInteractions / totalReach) * 10000) / 100
            : 0;

        // Prior-period engagement rate (for delta)
        const priorEngagementRate = priorTotals.totalReach > 0
            ? Math.round((priorTotals.totals.totalInteractions / priorTotals.totalReach) * 10000) / 100
            : 0;

        // Compute delta percentages
        const pctDelta = (current: number, prior: number): number => {
            if (prior === 0) return current > 0 ? 100 : 0;
            return Math.round(((current - prior) / prior) * 10000) / 100;
        };

        // Save/Send rate = saves or shares / reach * 100
        const saveRate = totalReach > 0
            ? Math.round((totals.saves / totalReach) * 10000) / 100
            : 0;
        const sendRate = totalReach > 0
            ? Math.round((totals.shares / totalReach) * 10000) / 100
            : 0;
        const priorSaveRate = priorTotals.totalReach > 0
            ? Math.round((priorTotals.totals.saves / priorTotals.totalReach) * 10000) / 100
            : 0;
        const priorSendRate = priorTotals.totalReach > 0
            ? Math.round((priorTotals.totals.shares / priorTotals.totalReach) * 10000) / 100
            : 0;

        // Cadence: count posts in trailing 7d and trailing 30d windows
        const now = endDate.getTime();
        const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
        const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

        const postTimestamps = posts.map(p => new Date(p.timestamp).getTime());
        const postsLast7d = posts.filter((_, i) => postTimestamps[i] >= sevenDaysAgo);
        const postsLast30d = posts.filter((_, i) => postTimestamps[i] >= thirtyDaysAgo);

        const reelsLast7d = postsLast7d.filter(p => p.mediaType === 'VIDEO').length;
        const carouselsLast7d = postsLast7d.filter(p => p.mediaType === 'CAROUSEL_ALBUM').length;
        const photosLast7d = postsLast7d.filter(p => p.mediaType === 'IMAGE').length;
        const reelsLast30d = postsLast30d.filter(p => p.mediaType === 'VIDEO').length;

        // Per-week rates over the last 30d (more stable than raw 7d count)
        const weeksIn30d = 30 / 7;
        const reelsPerWeek = Math.round((reelsLast30d / weeksIn30d) * 10) / 10;
        const feedPostsPerWeek = Math.round((postsLast30d.length / weeksIn30d) * 10) / 10;

        // Content mix: percentage of last-30d posts by type
        const total30d = postsLast30d.length || 1; // avoid div-by-zero
        const contentMix = {
            reels: Math.round((postsLast30d.filter(p => p.mediaType === 'VIDEO').length / total30d) * 100),
            carousels: Math.round((postsLast30d.filter(p => p.mediaType === 'CAROUSEL_ALBUM').length / total30d) * 100),
            photos: Math.round((postsLast30d.filter(p => p.mediaType === 'IMAGE').length / total30d) * 100),
        };
        const carouselMixPercent = contentMix.carousels;

        // Top post by total interactions
        const topPost = posts.length > 0
            ? posts.reduce((best, p) =>
                (p.totalInteractions || 0) > (best.totalInteractions || 0) ? p : best
            )
            : null;

        // AI coaching — fire after metrics are computed, but don't block on failure.
        // 12h cached internally so this is cheap on warm requests.
        const ranked = posts
            .filter(p => (p.reach || 0) > 0)
            .sort((a, b) => {
                const aER = ((a.likeCount + a.commentsCount + (a.shares || 0) + (a.saved || 0)) / (a.reach || 1)) * 100;
                const bER = ((b.likeCount + b.commentsCount + (b.shares || 0) + (b.saved || 0)) / (b.reach || 1)) * 100;
                return bER - aER;
            });
        const aiCoachingPlan = await generateAICoachingPlan({
            period: periodParam as '7d' | '30d' | '90d',
            metrics: {
                reelsPerWeek,
                feedPostsPerWeek,
                carouselMixPercent,
                storiesActive: stories.length,
                engagementRate,
                saveRate,
                sendRate,
                followers: profile.followersCount,
                followerChange: netFollowerChange,
                followerChangePercent: profile.followersCount > 0
                    ? Math.round((netFollowerChange / profile.followersCount) * 10000) / 100
                    : 0,
                replyRate,
                avgReplyHours: avgResponseHours,
                totalComments: replyAggregate.totalComments,
            },
            topPosts: ranked.slice(0, 3).map(p => ({
                caption: p.caption || '',
                mediaType: p.mediaType,
                engagementRate: ((p.likeCount + p.commentsCount + (p.shares || 0) + (p.saved || 0)) / (p.reach || 1)) * 100,
                reach: p.reach || 0,
                saved: p.saved || 0,
                shares: p.shares || 0,
            })),
            bottomPosts: ranked.slice(-3).reverse().map(p => ({
                caption: p.caption || '',
                mediaType: p.mediaType,
                engagementRate: ((p.likeCount + p.commentsCount + (p.shares || 0) + (p.saved || 0)) / (p.reach || 1)) * 100,
                reach: p.reach || 0,
            })),
        });

        return NextResponse.json({
            configured: true,
            profile: {
                username: profile.username,
                name: profile.name,
                followersCount: profile.followersCount,
                mediaCount: profile.mediaCount,
                profilePictureUrl: profile.profilePictureUrl,
            },
            summary: {
                followers: profile.followersCount,
                followerChange: netFollowerChange,
                followerChangePercent: profile.followersCount > 0
                    ? Math.round((netFollowerChange / profile.followersCount) * 10000) / 100
                    : 0,
                totalReach,
                totalViews: totals.views,
                totalInteractions: totals.totalInteractions,
                totalEngaged: totals.accountsEngaged,
                profileViews: totals.profileViews,
                likes: totals.likes,
                comments: totals.comments,
                shares: totals.shares,
                saves: totals.saves,
                engagementRate,
                saveRate,
                sendRate,
            },
            commentReplyStats: {
                totalComments: replyAggregate.totalComments,
                replied: replyAggregate.replied,
                unreplied: replyAggregate.totalComments - replyAggregate.replied,
                replyRate,
                avgResponseHours,
            },
            unrepliedInbox,
            aiCoachingPlan,
            priorPeriod: {
                totalReach: priorTotals.totalReach,
                totalViews: priorTotals.totals.views,
                totalInteractions: priorTotals.totals.totalInteractions,
                engagementRate: priorEngagementRate,
                saveRate: priorSaveRate,
                sendRate: priorSendRate,
            },
            deltas: {
                viewsPct: pctDelta(totals.views, priorTotals.totals.views),
                reachPct: pctDelta(totalReach, priorTotals.totalReach),
                interactionsPct: pctDelta(totals.totalInteractions, priorTotals.totals.totalInteractions),
                engagementRatePct: pctDelta(engagementRate, priorEngagementRate),
                saveRatePct: pctDelta(saveRate, priorSaveRate),
                sendRatePct: pctDelta(sendRate, priorSendRate),
            },
            cadence: {
                postsLast7d: postsLast7d.length,
                postsLast30d: postsLast30d.length,
                reelsLast7d,
                reelsLast30d,
                carouselsLast7d,
                photosLast7d,
                feedPostsPerWeek,
                reelsPerWeek,
                carouselMixPercent,
                storiesActive: stories.length,
            },
            contentMix,
            stories: stories.map(s => ({
                id: s.id,
                mediaType: s.mediaType,
                mediaUrl: s.mediaUrl,
                thumbnailUrl: s.thumbnailUrl,
                permalink: s.permalink,
                timestamp: s.timestamp,
                reach: s.reach || 0,
                replies: s.replies || 0,
                navigationForward: s.navigationForward || 0,
                navigationBack: s.navigationBack || 0,
                navigationExited: s.navigationExited || 0,
                navigationNext: s.navigationNext || 0,
            })),
            dailyInsights: daily,
            posts: posts.map(p => {
                const interactions = (p.likeCount || 0) + (p.commentsCount || 0) + (p.shares || 0) + (p.saved || 0);
                const reach = p.reach || 0;
                const postEngagementRate = reach > 0
                    ? Math.round((interactions / reach) * 10000) / 100
                    : 0;
                const unrepliedCount = (p.commentsFetched || 0) - (p.commentsReplied || 0);
                return {
                    id: p.id,
                    caption: p.caption?.substring(0, 120) || '',
                    mediaType: p.mediaType,
                    permalink: p.permalink,
                    timestamp: p.timestamp,
                    likeCount: p.likeCount,
                    commentsCount: p.commentsCount,
                    views: p.views || 0,
                    reach,
                    shares: p.shares || 0,
                    saved: p.saved || 0,
                    totalInteractions: p.totalInteractions || 0,
                    engagementRate: postEngagementRate,
                    unrepliedCount: unrepliedCount > 0 ? unrepliedCount : 0,
                    avgReplyHours: p.avgReplyHours ?? null,
                    plays: p.plays,
                    avgWatchTime: p.avgWatchTime,
                };
            }),
            topPost: topPost ? {
                id: topPost.id,
                caption: topPost.caption?.substring(0, 120) || '',
                mediaType: topPost.mediaType,
                permalink: topPost.permalink,
                totalInteractions: topPost.totalInteractions || 0,
            } : null,
            period: periodParam,
            since,
            until,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Instagram API error:', message);
        return NextResponse.json({ configured: true, error: message }, { status: 500 });
    }
}
