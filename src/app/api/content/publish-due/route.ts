// Publish Due Posts — Real-time publishing for queued posts
// Called every 2 minutes by n8n workflow (self-hosted at n8n.chinupaesthetics.com).
// Finds SCHEDULED posts whose scheduled_for <= NOW() and publishes them.
// Auth: PUBLISH_SECRET bearer token (for n8n) or authenticated session (for browser).

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { publishWithTransientRetry } from '@/lib/integrations/meta-publisher';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
    // Auth: accept PUBLISH_SECRET bearer token (n8n) or session (browser)
    const authHeader = req.headers.get('authorization');
    const publishSecret = process.env.PUBLISH_SECRET;

    let authorized = false;
    if (publishSecret && authHeader === `Bearer ${publishSecret}`) {
        authorized = true;
    } else {
        const session = await getServerSession(authOptions);
        if (session?.user) {
            authorized = true;
        }
    }

    if (!authorized) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const result = await sql`
            SELECT * FROM content_posts
            WHERE status = 'SCHEDULED'
            AND scheduled_for <= NOW()
            ORDER BY scheduled_for ASC
            LIMIT 5
        `;

        if (result.rows.length === 0) {
            return NextResponse.json({ published: [], count: 0 });
        }

        const published: { id: string; status: string; platforms: string[] }[] = [];

        for (const row of result.rows) {
            const platforms: string[] = JSON.parse(row.platforms || '[]');
            const caption = row.caption || '';
            const mediaUrls: string[] = JSON.parse(row.media_urls || '[]');
            const metadata = JSON.parse(row.metadata || '{}');
            const gbpLocations: string[] | undefined = metadata.gbpLocations;
            const postType = row.post_type || 'feed';

            try {
                await sql`UPDATE content_posts SET status = 'PUBLISHING' WHERE id = ${row.id}`;

                const results = await publishWithTransientRetry(
                    platforms, caption, mediaUrls, undefined, postType, gbpLocations
                );

                const allSucceeded = results.every(r => r.success);
                const someSucceeded = results.some(r => r.success);
                const finalStatus = allSucceeded ? 'PUBLISHED' : someSucceeded ? 'PARTIAL' : 'FAILED';

                const errors: Record<string, string> = {};
                for (const r of results) {
                    if (!r.success && r.error) {
                        errors[r.platform] = r.error;
                    }
                }

                await sql`
                    UPDATE content_posts
                    SET status = ${finalStatus},
                        published_at = NOW(),
                        errors = ${JSON.stringify(errors)},
                        publish_results = ${JSON.stringify(results)}
                    WHERE id = ${row.id}
                `;

                published.push({ id: row.id, status: finalStatus, platforms });
                console.log(`[publish-due] Published ${row.id} → ${finalStatus}`);
            } catch (err) {
                const msg = err instanceof Error ? err.message : 'Unknown error';
                await sql`
                    UPDATE content_posts
                    SET status = 'FAILED',
                        errors = ${JSON.stringify({ _publish: msg })}
                    WHERE id = ${row.id}
                `;
                published.push({ id: row.id, status: 'FAILED', platforms });
                console.error(`[publish-due] Failed ${row.id}:`, err);
            }
        }

        return NextResponse.json({ published, count: published.length });
    } catch (error) {
        console.error('[publish-due] Error:', error);
        return NextResponse.json({ error: 'Failed to publish due posts' }, { status: 500 });
    }
}
