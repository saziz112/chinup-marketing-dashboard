/**
 * Vercel Cron: Zenoti Incremental Sync
 * Runs daily at 8 AM UTC (4 AM ET), before the 9 AM research sync and the
 * 10 AM offline-conversions upload so those see fresh patient data.
 * Pulls Zenoti sales / appointments / guests since the last watermark into
 * the unified mb_* tables, then drops campaign-segment caches.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/cron-auth';
import { incrementalZenotiSync } from '@/lib/integrations/zenoti-sync';
import { pgCacheInvalidatePrefix } from '@/lib/pg-cache';

export const maxDuration = 300; // pulls a 120-day forward appointment window

export async function GET(req: NextRequest) {
    // Verify cron secret (Vercel sets this header for cron jobs)
    if (!isCronAuthorized(req.headers.get('authorization'))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const zenoti = await incrementalZenotiSync();

        console.log(`[sync-zenoti] ${zenoti.newSales} sales, ${zenoti.newAppts} appts, ${zenoti.newGuests} guests`);

        // Fresh patient data just landed — drop campaign-segment caches so the next
        // request rebuilds from the updated tables (prevents targeting patients who just visited).
        await Promise.all([
            pgCacheInvalidatePrefix('lapsed_v2_').catch(() => {}),
            pgCacheInvalidatePrefix('cancelled_').catch(() => {}),
            pgCacheInvalidatePrefix('consult_').catch(() => {}),
        ]);

        return NextResponse.json({ zenoti });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Zenoti sync failed';
        console.error('[sync-zenoti] Error:', message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
