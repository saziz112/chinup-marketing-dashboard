/**
 * Vercel Cron: Sync Research Data + GHL
 * Runs daily at 9 AM UTC (5 AM ET).
 * Incrementally syncs social posts (IG), Search Console query data,
 * and GHL contacts into Postgres. Patient data (Zenoti) syncs in its
 * own cron: /api/cron/sync-zenoti (8 AM UTC).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { incrementalSocialSync } from '@/lib/integrations/social-posts-sync';
import { incrementalSearchConsoleSync } from '@/lib/integrations/search-console-sync';
import { incrementalGhlSync } from '@/lib/integrations/ghl-contacts-sync';
import { pgCacheInvalidatePrefix } from '@/lib/pg-cache';

export const maxDuration = 300; // Zenoti incremental sync now pulls a 120-day forward appt window

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
        // MindBody incremental sync is FROZEN at the 2026-07-01 cutover (MindBody is
        // authoritative ≤ 6/30 and produces no new data after). Zenoti sync runs in
        // its own dedicated cron (/api/cron/sync-zenoti, 8 AM UTC).
        const [social, gsc, ghl] = await Promise.all([
            incrementalSocialSync().catch(e => ({
                total: 0, apiCalls: 0, done: true,
                chunkLabel: `Social sync error: ${e.message}`,
            })),
            incrementalSearchConsoleSync().catch(e => ({
                total: 0, apiCalls: 0, done: true,
                chunkLabel: `GSC sync error: ${e.message}`,
            })),
            incrementalGhlSync().catch(e => ({
                newContacts: 0, apiCalls: 0,
                error: e.message,
            })),
        ]);

        console.log(`[sync-research] Social: ${social.chunkLabel} | GSC: ${gsc.chunkLabel} | GHL: ${ghl.newContacts} new contacts`);

        // Fresh GHL data just landed — drop campaign-segment caches so the next
        // request rebuilds from the updated tables (prevents targeting patients who just visited).
        await Promise.all([
            pgCacheInvalidatePrefix('lapsed_v2_').catch(() => {}),
            pgCacheInvalidatePrefix('cancelled_').catch(() => {}),
            pgCacheInvalidatePrefix('consult_').catch(() => {}),
        ]);

        return NextResponse.json({
            social,
            searchConsole: gsc,
            ghl,
            totalApiCalls: social.apiCalls + gsc.apiCalls + ghl.apiCalls,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Sync failed';
        console.error('[sync-research] Error:', message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
