import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isMetaConfigured, getIGMedia } from '@/lib/integrations/meta-organic';
import { isYouTubeConfigured, getRecentVideos } from '@/lib/integrations/youtube';

export interface ContentPost {
    id: string;
    platform: 'instagram' | 'youtube';
    title: string;
    description: string;
    publishedAt: string; // ISO date string
    thumbnailUrl: string;
    url: string;
    views: number;
    likes: number;
    comments: number;
    shares: number;
    engagementRate: number;
    mediaType?: string; // e.g. 'VIDEO', 'IMAGE', 'short'
}

export async function GET(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const unifiedPosts: ContentPost[] = [];
        const errors: string[] = [];

        // 1. Fetch Instagram Posts
        try {
            if (isMetaConfigured()) {
                const igPosts = await getIGMedia(50);
                for (const p of igPosts) {
                    const views = p.views || p.plays || 0;
                    const likes = p.likeCount || 0;
                    const comments = p.commentsCount || 0;
                    const shares = p.shares || 0;
                    // Instagram total interactions isn't always fully hydrated depending on type, use likes+comments+shares
                    const totalEng = likes + comments + shares + (p.saved || 0);

                    unifiedPosts.push({
                        id: `ig_${p.id}`,
                        platform: 'instagram',
                        title: p.caption ? p.caption.split('\n')[0].substring(0, 100) : 'Instagram Post',
                        description: p.caption || '',
                        publishedAt: p.timestamp,
                        thumbnailUrl: p.mediaType === 'VIDEO' ? '' : p.mediaUrl, // IG Graph doesn't always provide reliable thumbnails for all videos easily without separate fields
                        url: p.permalink,
                        views,
                        likes,
                        comments,
                        shares,
                        engagementRate: views > 0 ? (totalEng / views) * 100 : 0,
                        mediaType: p.mediaType
                    });
                }
            }
        } catch (e: any) {
            console.error('[Content API] Error fetching Instagram posts:', e.message);
            errors.push('Instagram API Error: ' + e.message);
        }

        // 2. Fetch YouTube Videos
        try {
            if (isYouTubeConfigured()) {
                const ytVideos = await getRecentVideos(50);
                for (const v of ytVideos) {
                    const views = v.viewCount;
                    const likes = v.likeCount;
                    const comments = v.commentCount;
                    const totalEng = likes + comments;

                    unifiedPosts.push({
                        id: `yt_${v.id}`,
                        platform: 'youtube',
                        title: v.title,
                        description: v.description || '',
                        publishedAt: v.publishedAt,
                        thumbnailUrl: v.thumbnailUrl,
                        url: `https://www.youtube.com/watch?v=${v.id}`,
                        views,
                        likes,
                        comments,
                        shares: 0, // YouTube API doesn't expose shares natively on list endpoints
                        engagementRate: views > 0 ? (totalEng / views) * 100 : 0,
                        mediaType: v.isShort ? 'SHORT' : 'VIDEO'
                    });
                }
            }
        } catch (e: any) {
            console.error('[Content API] Error fetching YouTube videos:', e.message);
            errors.push('YouTube API Error: ' + e.message);
        }

        // 3. Sort all posts globally by publishedAt date descending
        unifiedPosts.sort((a, b) => {
            return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
        });

        return NextResponse.json({
            posts: unifiedPosts,
            totalAnalyzed: unifiedPosts.length,
            errors: errors.length > 0 ? errors : undefined
        });

    } catch (error: any) {
        console.error('Content posts API global error:', error.message);
        return NextResponse.json({ error: 'Failed to aggregate content posts' }, { status: 500 });
    }
}
