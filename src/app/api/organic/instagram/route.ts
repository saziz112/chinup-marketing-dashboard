import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { subDays, format } from 'date-fns';
import {
    isMetaConfigured,
    getIGProfile,
    getIGInsights,
    getIGMedia,
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
                error: 'Instagram not connected. Add META_PAGE_ACCESS_TOKEN and META_IG_USER_ID to .env.local',
            }, { status: 200 });
        }

        const searchParams = request.nextUrl.searchParams;
        const periodParam = searchParams.get('period') || '30d';
        const days = periodParam === '7d' ? 7 : periodParam === '90d' ? 90 : 30;

        // IG follower_count only supports since within 30 days of today
        const endDate = new Date();
        const startDate = subDays(endDate, days - 1);
        const since = format(startDate, 'yyyy-MM-dd');
        const until = format(endDate, 'yyyy-MM-dd');

        // Fetch profile, insights, and recent posts in parallel
        const [profile, insights, posts] = await Promise.all([
            getIGProfile(),
            getIGInsights(since, until),
            getIGMedia(25),
        ]);

        const { daily, totals } = insights;

        // Compute reach total + follower change from daily data
        const totalReach = daily.reduce((sum, d) => sum + d.reach, 0);
        const netFollowerChange = daily.reduce((sum, d) => sum + d.followerCount, 0);

        // Engagement rate = total interactions / total reach * 100
        const engagementRate = totalReach > 0
            ? Math.round((totals.totalInteractions / totalReach) * 10000) / 100
            : 0;

        // Top post by total interactions
        const topPost = posts.length > 0
            ? posts.reduce((best, p) =>
                (p.totalInteractions || 0) > (best.totalInteractions || 0) ? p : best
            )
            : null;

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
            },
            dailyInsights: daily,
            posts: posts.map(p => ({
                id: p.id,
                caption: p.caption?.substring(0, 120) || '',
                mediaType: p.mediaType,
                permalink: p.permalink,
                timestamp: p.timestamp,
                likeCount: p.likeCount,
                commentsCount: p.commentsCount,
                views: p.views || 0,
                reach: p.reach || 0,
                shares: p.shares || 0,
                saved: p.saved || 0,
                totalInteractions: p.totalInteractions || 0,
                plays: p.plays,
                avgWatchTime: p.avgWatchTime,
            })),
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
