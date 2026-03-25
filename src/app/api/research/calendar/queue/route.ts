/**
 * POST /api/research/calendar/queue
 * Bulk-create DRAFT content_posts from a generated content calendar.
 * Includes duplicate detection — replaces existing DRAFT calendar posts for the same month.
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sql } from '@vercel/postgres';

const PLATFORM_MAP: Record<string, string> = {
    'IG': 'instagram', 'Instagram': 'instagram',
    'FB': 'facebook', 'Facebook': 'facebook',
    'YT': 'youtube', 'YouTube': 'youtube',
};

const POST_TYPE_MAP: Record<string, string> = {
    'Reel': 'reel', 'Story': 'story', 'Post': 'feed', 'Carousel': 'feed',
    'Image': 'feed', 'Video': 'feed', 'Short': 'reel',
};

// Best posting times by platform (EST hours)
const BEST_TIMES: Record<string, number> = {
    'instagram': 9, 'facebook': 10, 'youtube': 12,
};

export async function POST(req: Request) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { days, month, year } = await req.json();
        if (!days?.length || !month || !year) {
            return NextResponse.json({ error: 'days, month, and year required' }, { status: 400 });
        }

        const calendarMonth = `${year}-${String(month).padStart(2, '0')}`;

        // Check for existing DRAFT calendar posts for this month and delete them
        const existing = await sql`
            SELECT id FROM content_posts
            WHERE status = 'DRAFT'
            AND metadata::text LIKE ${`%"calendarMonth":"${calendarMonth}"%`}
        `;
        const replaced = existing.rows.length;

        if (replaced > 0) {
            const ids = existing.rows.map(r => r.id);
            for (const id of ids) {
                await sql`DELETE FROM content_posts WHERE id = ${id} AND status = 'DRAFT'`;
            }
        }

        let created = 0;
        let failed = 0;

        for (const day of days) {
            try {
                const id = `post_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
                const platform = PLATFORM_MAP[day.platform] || 'instagram';
                const postType = POST_TYPE_MAP[day.format] || 'feed';
                const caption = day.caption
                    ? `${day.caption}${day.hashtags ? '\n\n' + day.hashtags : ''}`
                    : `${day.topic}${day.hashtags ? '\n\n' + day.hashtags : ''}`;

                // Schedule for best time on the day
                const hour = BEST_TIMES[platform] || 9;
                const scheduledFor = `${day.date}T${String(hour).padStart(2, '0')}:00:00-05:00`; // EST

                const metadata = JSON.stringify({
                    source: 'research_calendar',
                    calendarMonth,
                    topic: day.topic,
                    category: day.category,
                });

                await sql`
                    INSERT INTO content_posts (id, platforms, caption, media_urls, status, scheduled_for, created_at, post_type, metadata, created_by)
                    VALUES (
                        ${id},
                        ${JSON.stringify([platform])},
                        ${caption},
                        ${'[]'},
                        ${'DRAFT'},
                        ${scheduledFor},
                        ${new Date().toISOString()},
                        ${postType},
                        ${metadata},
                        ${session.user.email}
                    )
                `;
                created++;
            } catch (err) {
                console.error('[calendar/queue] Failed to create draft:', err);
                failed++;
            }
        }

        return NextResponse.json({ created, failed, replaced });
    } catch (error: any) {
        console.error('[calendar/queue] Error:', error);
        return NextResponse.json({ error: error.message || 'Queue creation failed' }, { status: 500 });
    }
}
