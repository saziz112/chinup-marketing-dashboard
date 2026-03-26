/**
 * Vercel Cron: Sync Research Data
 * Runs daily at 9 AM UTC (5 AM ET).
 * Incrementally syncs social posts (IG) and Search Console query data
 * into Postgres for the Market Intel tab.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { incrementalSocialSync } from '@/lib/integrations/social-posts-sync';
import { incrementalSearchConsoleSync } from '@/lib/integrations/search-console-sync';

export const maxDuration = 60;

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
        if (!user || user.isAdmin !== true) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
    }

    try {
        const [social, gsc] = await Promise.all([
            incrementalSocialSync().catch(e => ({
                total: 0, apiCalls: 0, done: true,
                chunkLabel: `Social sync error: ${e.message}`,
            })),
            incrementalSearchConsoleSync().catch(e => ({
                total: 0, apiCalls: 0, done: true,
                chunkLabel: `GSC sync error: ${e.message}`,
            })),
        ]);

        console.log(`[sync-research] Social: ${social.chunkLabel} | GSC: ${gsc.chunkLabel}`);

        return NextResponse.json({
            social,
            searchConsole: gsc,
            totalApiCalls: social.apiCalls + gsc.apiCalls,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Sync failed';
        console.error('[sync-research] Error:', message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
