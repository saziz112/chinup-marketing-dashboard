import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
    isYouTubeConfigured,
    getChannelInfo,
    getRecentVideos,
} from '@/lib/integrations/youtube';
import type { YTSummary } from '@/lib/integrations/youtube';

export async function GET(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (!isYouTubeConfigured()) {
            return NextResponse.json({
                configured: false,
                error: 'YouTube not connected. Add YOUTUBE_API_KEY and YOUTUBE_CHANNEL_ID to .env.local',
            }, { status: 200 });
        }

        const searchParams = request.nextUrl.searchParams;
        const periodParam = searchParams.get('period') || '30d';
        const days = periodParam === '7d' ? 7 : periodParam === '90d' ? 90 : 30;

        // Fetch channel info + recent videos in parallel
        const [channel, allVideos] = await Promise.all([
            getChannelInfo(),
            getRecentVideos(50),
        ]);

        // Filter videos by period
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);

        const periodVideos = allVideos.filter(
            v => new Date(v.publishedAt) >= cutoffDate
        );

        // Compute summary for period videos
        const recentVideoViews = periodVideos.reduce((sum, v) => sum + v.viewCount, 0);
        const recentVideoLikes = periodVideos.reduce((sum, v) => sum + v.likeCount, 0);
        const recentVideoComments = periodVideos.reduce((sum, v) => sum + v.commentCount, 0);
        const shortsCount = periodVideos.filter(v => v.isShort).length;
        const longFormCount = periodVideos.filter(v => !v.isShort).length;

        const engagementRate = recentVideoViews > 0
            ? Math.round(((recentVideoLikes + recentVideoComments) / recentVideoViews) * 10000) / 100
            : 0;

        const avgViewsPerVideo = periodVideos.length > 0
            ? Math.round(recentVideoViews / periodVideos.length)
            : 0;

        const summary: YTSummary = {
            subscribers: channel.subscriberCount,
            totalViews: channel.viewCount,
            totalVideos: channel.videoCount,
            recentVideoViews,
            recentVideoLikes,
            recentVideoComments,
            engagementRate,
            avgViewsPerVideo,
            shortsCount,
            longFormCount,
        };

        return NextResponse.json({
            configured: true,
            channel: {
                title: channel.title,
                customUrl: channel.customUrl,
                thumbnailUrl: channel.thumbnailUrl,
                subscriberCount: channel.subscriberCount,
                viewCount: channel.viewCount,
                videoCount: channel.videoCount,
            },
            summary,
            videos: periodVideos.map(v => ({
                id: v.id,
                title: v.title.substring(0, 120),
                publishedAt: v.publishedAt,
                thumbnailUrl: v.thumbnailUrl,
                durationSeconds: v.durationSeconds,
                viewCount: v.viewCount,
                likeCount: v.likeCount,
                commentCount: v.commentCount,
                isShort: v.isShort,
            })),
            period: periodParam,
            videosInPeriod: periodVideos.length,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('YouTube API error:', message);
        return NextResponse.json({ configured: true, error: message }, { status: 500 });
    }
}
