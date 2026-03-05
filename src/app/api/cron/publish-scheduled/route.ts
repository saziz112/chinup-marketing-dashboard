// Vercel Cron: Publish Scheduled Posts
// Runs every 5 minutes. Finds posts with status='SCHEDULED' and scheduled_for <= NOW(),
// then publishes them via the normal publishing pipeline.
// Cron config in vercel.json: schedule "every 5 minutes"

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { publishToMultiplePlatforms } from '@/lib/integrations/meta-publisher';

export async function GET(req: NextRequest) {
    // Verify cron secret (Vercel sets this header for cron jobs)
    const authHeader = req.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    // In production, verify the cron secret. In dev, allow unauthenticated.
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
            return NextResponse.json({ message: 'No scheduled posts due', processed: 0 });
        }

        const processed: { id: string; status: string; platforms: string[] }[] = [];

        for (const row of result.rows) {
            const platforms: string[] = JSON.parse(row.platforms || '[]');
            const caption = row.caption || '';
            const mediaUrls: string[] = JSON.parse(row.media_urls || '[]');
            const mediaUrl = mediaUrls[0] || undefined;
            const metadata = JSON.parse(row.metadata || '{}');
            const gbpLocations: string[] | undefined = metadata.gbpLocations;

            try {
                // Mark as publishing
                await sql`UPDATE content_posts SET status = 'PUBLISHING' WHERE id = ${row.id}`;

                // Publish to all platforms
                const results = await publishToMultiplePlatforms(platforms, caption, mediaUrl, undefined, 'feed', gbpLocations);

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

        return NextResponse.json({
            message: `Processed ${processed.length} scheduled post(s)`,
            processed,
        });
    } catch (error) {
        console.error('[cron] Error:', error);
        return NextResponse.json({ error: 'Cron job failed' }, { status: 500 });
    }
}
