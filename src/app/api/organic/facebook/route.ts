import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { subDays, format } from 'date-fns';
import {
    isMetaConfigured,
    getFBPageInfo,
    getFBInsights,
} from '@/lib/integrations/meta-organic';

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

        const endDate = new Date();
        const startDate = subDays(endDate, days);
        const since = format(startDate, 'yyyy-MM-dd');
        const until = format(endDate, 'yyyy-MM-dd');

        const [pageInfo, insights] = await Promise.all([
            getFBPageInfo(),
            getFBInsights(since, until),
        ]);

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
                followerChangePercent: pageInfo.followersCount > 0
                    ? Math.round((followerChange / pageInfo.followersCount) * 10000) / 100
                    : 0,
                totalVideoViews,
                totalEngagements,
                totalPageViews,
                engagementRate,
            },
            dailyInsights: insights,
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
