// Vercel Cron: Publish Scheduled Posts
// Runs daily at 7 AM UTC (Hobby plan limitation).
// Finds posts with status='SCHEDULED' and scheduled_for <= NOW(),
// then publishes them via the normal publishing pipeline.
// Also archives old posts (>7 days) after publishing.

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { publishWithTransientRetry } from '@/lib/integrations/meta-publisher';
import { archiveOldPosts } from '@/lib/content-publisher';

export async function GET(req: NextRequest) {
    // Verify cron secret (Vercel sets this header for cron jobs)
    const authHeader = req.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret) {
        if (authHeader !== `Bearer ${cronSecret}`) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
    } else {
        // No cron secret: require admin session as fallback
        const session = await getServerSession(authOptions);
        const user = session?.user as Record<string, unknown> | undefined;
        if (!user?.isAdmin) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
    }

    try {
        // Find all scheduled posts that are due
        const result = await sql`
            SELECT * FROM content_posts
            WHERE status = 'SCHEDULED'
            AND scheduled_for <= NOW()
            ORDER BY scheduled_for ASC
            LIMIT 10
        `;

        if (result.rows.length === 0) {
            // Still run archive even if no posts to publish
            const archived = await archiveOldPosts(7);
            return NextResponse.json({ message: 'No scheduled posts due', processed: 0, archived });
        }

        const processed: { id: string; status: string; platforms: string[] }[] = [];

        for (const row of result.rows) {
            const platforms: string[] = JSON.parse(row.platforms || '[]');
            const caption = row.caption || '';
            const mediaUrls: string[] = JSON.parse(row.media_urls || '[]');
            const metadata = JSON.parse(row.metadata || '{}');
            const gbpLocations: string[] | undefined = metadata.gbpLocations;

            try {
                // Mark as publishing
                await sql`UPDATE content_posts SET status = 'PUBLISHING' WHERE id = ${row.id}`;

                // Publish to all platforms — pass full mediaUrls array for carousel support
                const postType = row.post_type || 'feed';
                const results = await publishWithTransientRetry(platforms, caption, mediaUrls, undefined, postType, gbpLocations);

                const allSucceeded = results.every(r => r.success);
                const someSucceeded = results.some(r => r.success);
                const finalStatus = allSucceeded ? 'PUBLISHED' : someSucceeded ? 'PARTIAL' : 'FAILED';

                const errors: Record<string, string> = {};
                for (const r of results) {
                    if (!r.success && r.error) {
                        errors[r.platform] = r.error;
                    }
                }

                // Update post status
                await sql`
                    UPDATE content_posts
                    SET status = ${finalStatus},
                        published_at = NOW(),
                        errors = ${JSON.stringify(errors)},
                        publish_results = ${JSON.stringify(results)}
                    WHERE id = ${row.id}
                `;

                processed.push({ id: row.id, status: finalStatus, platforms });
                console.log(`[cron] Published ${row.id} → ${finalStatus}`);
            } catch (err) {
                const msg = err instanceof Error ? err.message : 'Unknown error';
                await sql`
                    UPDATE content_posts
                    SET status = 'FAILED',
                        errors = ${JSON.stringify({ _cron: msg })}
                    WHERE id = ${row.id}
                `;
                processed.push({ id: row.id, status: 'FAILED', platforms });
                console.error(`[cron] Failed to publish ${row.id}:`, err);
            }
        }

        // Archive old posts (>7 days)
        const archived = await archiveOldPosts(7);

        return NextResponse.json({
            message: `Processed ${processed.length} scheduled post(s)`,
            processed,
            archived,
        });
    } catch (error) {
        console.error('[cron] Error:', error);
        return NextResponse.json({ error: 'Cron job failed' }, { status: 500 });
    }
}
