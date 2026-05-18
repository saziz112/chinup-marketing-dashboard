import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { subDays, format } from 'date-fns';
import {
    isMetaConfigured,
    getFBPageInfo,
    getFBInsights,
    getFBPosts,
    clearMetaCache,
} from '@/lib/integrations/meta-organic';
import { generateAIFBCoachingPlan } from '@/lib/fb-coaching-ai';

export async function GET(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (!isMetaConfigured()) {
            return NextResponse.json({
                configured: false,
                error: 'Facebook not connected. Add META_PAGE_ACCESS_TOKEN and META_PAGE_ID to .env.local',
            }, { status: 200 });
        }

        const searchParams = request.nextUrl.searchParams;
        const periodParam = searchParams.get('period') || '30d';
        const days = periodParam === '7d' ? 7 : periodParam === '90d' ? 90 : 30;
        if (searchParams.get('force') === 'true') clearMetaCache();

        const endDate = new Date();
        const startDate = subDays(endDate, days);
        const since = format(startDate, 'yyyy-MM-dd');
        const until = format(endDate, 'yyyy-MM-dd');

        const postLimit = days <= 7 ? 7 : days <= 30 ? 15 : 30;
        const [pageInfo, insights, posts] = await Promise.all([
            getFBPageInfo(),
            getFBInsights(since, until),
            getFBPosts(postLimit),
        ]);

        // Aggregate comment-reply stats + flat unreplied inbox across recent posts
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

        const unrepliedInbox = posts.flatMap(p =>
            (p.unrepliedComments || []).map(c => ({
                commentId: c.id,
                text: c.text,
                username: c.username,
                timestamp: c.timestamp,
                postId: p.id,
                postCaption: (p.message || '').substring(0, 100),
                postMediaType: p.statusType || 'FB_POST',
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

        // Aggregate daily metrics
        const totalVideoViews = insights.reduce((sum, d) => sum + d.pageVideoViews, 0);
        const totalEngagements = insights.reduce((sum, d) => sum + d.pagePostEngagements, 0);
        const totalPageViews = insights.reduce((sum, d) => sum + d.pageViewsTotal, 0);

        // Follower trend: first vs last day (page_follows is cumulative)
        const followerDays = insights.filter(d => d.pageFollows > 0);
        const followerChange = followerDays.length >= 2
            ? followerDays[followerDays.length - 1].pageFollows - followerDays[0].pageFollows
            : 0;

        // Engagement rate = total engagements / total video views * 100
        const engagementRate = totalVideoViews > 0
            ? Math.round((totalEngagements / totalVideoViews) * 10000) / 100
            : 0;

        const followerChangePercent = pageInfo.followersCount > 0
            ? Math.round((followerChange / pageInfo.followersCount) * 10000) / 100
            : 0;

        // AI coaching — cached 12h, returns null on failure
        const aiCoachingPlan = await generateAIFBCoachingPlan({
            period: periodParam as '7d' | '30d' | '90d',
            pageName: pageInfo.name,
            metrics: {
                followers: pageInfo.followersCount,
                followerChange,
                followerChangePercent,
                totalVideoViews,
                totalEngagements,
                totalPageViews,
                engagementRate,
            },
        });

        return NextResponse.json({
            configured: true,
            page: {
                name: pageInfo.name,
                followersCount: pageInfo.followersCount,
                fanCount: pageInfo.fanCount,
                link: pageInfo.link,
                picture: pageInfo.picture,
            },
            summary: {
                followers: pageInfo.followersCount,
                followerChange,
                followerChangePercent,
                totalVideoViews,
                totalEngagements,
                totalPageViews,
                engagementRate,
            },
            dailyInsights: insights,
            commentReplyStats: {
                totalComments: replyAggregate.totalComments,
                replied: replyAggregate.replied,
                unreplied: replyAggregate.totalComments - replyAggregate.replied,
                replyRate,
                avgResponseHours,
            },
            unrepliedInbox,
            aiCoachingPlan,
            days,
            period: periodParam,
            since,
            until,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Facebook API error:', message);
        return NextResponse.json({ configured: true, error: message }, { status: 500 });
    }
}
