/**
 * /api/admin/data-sync
 * Admin-only route for Zenoti + GHL data synchronization (MindBody is frozen history).
 * GET: Returns sync status (record counts, last sync dates, match rate)
 * POST: Triggers backfill or incremental sync
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sql } from '@/lib/db/sql';
import { getSyncStats, getAvailableTreatments } from '@/lib/integrations/mindbody-sync';
import {
    backfillGhlContacts,
    incrementalGhlSync,
    getGhlSyncStats,
} from '@/lib/integrations/ghl-contacts-sync';
import {
    backfillSocialPosts,
    incrementalSocialSync,
    getSocialPostsStats,
} from '@/lib/integrations/social-posts-sync';
import {
    backfillSearchConsole,
    incrementalSearchConsoleSync,
    getSearchConsoleStats,
} from '@/lib/integrations/search-console-sync';
import { incrementalZenotiSync } from '@/lib/integrations/zenoti-sync';

export const maxDuration = 300; // Zenoti sync now pulls a 120-day forward appt window (~54 rate-limited calls)

export async function GET(req: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const user = session.user as Record<string, unknown>;
    if (user.isAdmin !== true) {
        return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const action = req.nextUrl.searchParams.get('action');

    // Return available treatments for dropdown
    if (action === 'treatments') {
        const treatments = await getAvailableTreatments();
        return NextResponse.json({ treatments });
    }

    // Return full sync status — serialized to fit within postgres.js pool (max:5).
    // Parallel fan-out here runs 4×3-5 queries simultaneously, exceeding the pool
    // and hanging against Supabase transaction pooler. Each function internally
    // fans out ≤5 queries which fits in the pool.
    const mbStats = await getSyncStats();
    const ghlStats = await getGhlSyncStats();
    const socialStats = await getSocialPostsStats().catch(() => ({ totalPosts: 0, lastSync: null, platforms: [] }));
    const gscStats = await getSearchConsoleStats().catch(() => ({ totalRows: 0, lastSync: null, dateRange: { earliest: null, latest: null } }));

    // Zenoti split (post-migration). Guarded: the `source` column doesn't exist
    // until migrate-zenoti-schema runs, so fall back to "not migrated" cleanly.
    const zenotiStats = await (async () => {
        try {
            const { rows } = await sql`
                SELECT 'sales' AS t, source, COUNT(*)::int AS n FROM mb_sales_history GROUP BY source
                UNION ALL SELECT 'appts', source, COUNT(*)::int FROM mb_appointments_history GROUP BY source
                UNION ALL SELECT 'clients', source, COUNT(*)::int FROM mb_clients_cache GROUP BY source
            `;
            const bySource = { sales: {}, appts: {}, clients: {} } as Record<string, Record<string, number>>;
            for (const r of rows) bySource[r.t as string][(r.source as string) ?? 'null'] = r.n as number;
            const states = await sql`SELECT sync_type, last_sync_date FROM mb_sync_state WHERE sync_type LIKE 'zenoti%'`;
            return { migrated: true, bySource, syncStates: states.rows };
        } catch {
            return { migrated: false };
        }
    })();

    return NextResponse.json({
        mindbody: {
            salesCount: mbStats.salesCount,
            appointmentsCount: mbStats.appointmentsCount,
            clientsCount: mbStats.clientsCount,
            syncStates: mbStats.syncStates,
        },
        ghl: {
            totalContacts: ghlStats.totalContacts,
            byLocation: ghlStats.byLocation,
            withPhone: ghlStats.withPhone,
            withEmail: ghlStats.withEmail,
            lastSync: ghlStats.lastSync,
        },
        socialPosts: socialStats,
        searchConsole: gscStats,
        zenoti: zenotiStats,
    });
}

export async function POST(req: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const user = session.user as Record<string, unknown>;
    if (user.isAdmin !== true) {
        return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await req.json();
    const { action } = body as { action: string };

    try {
        switch (action) {
            case 'backfill-ghl': {
                const result = await backfillGhlContacts();
                return NextResponse.json({ action, ...result, continue: !result.done });
            }
            case 'reset-ghl': {
                await sql`DELETE FROM mb_sync_state WHERE sync_type IN ('ghl-contacts', 'ghl_backfill_progress')`;
                await sql`DELETE FROM ghl_contacts_map`;
                return NextResponse.json({ action, message: 'GHL sync state and contacts cleared. Run backfill again.' });
            }
            case 'sync':
            case 'sync-mindbody': {
                // MindBody is frozen at the 2026-07-01 Zenoti cutover. Re-running its
                // incremental sync could re-introduce post-cutover rows that Zenoti
                // already owns (integer vs GUID ids never conflict → double-counting).
                return NextResponse.json({
                    action,
                    error: 'MindBody sync is retired — MindBody is frozen history as of the 2026-07-01 Zenoti cutover. Use sync-zenoti / sync-ghl.',
                }, { status: 410 });
            }
            case 'sync-ghl': {
                const result = await incrementalGhlSync();
                return NextResponse.json({ action, ...result });
            }
            case 'backfill-social': {
                const result = await backfillSocialPosts();
                return NextResponse.json({ action, ...result, continue: !result.done });
            }
            case 'backfill-search-console': {
                const result = await backfillSearchConsole();
                return NextResponse.json({ action, ...result, continue: !result.done });
            }
            case 'sync-social': {
                const result = await incrementalSocialSync();
                return NextResponse.json({ action, ...result });
            }
            case 'sync-search-console': {
                const result = await incrementalSearchConsoleSync();
                return NextResponse.json({ action, ...result });
            }
            case 'reset-social': {
                await sql`DELETE FROM mb_sync_state WHERE sync_type IN ('social_posts', 'social_posts_backfill_progress')`;
                await sql`DELETE FROM social_posts`;
                return NextResponse.json({ action, message: 'Social posts data and sync state cleared.' });
            }
            case 'reset-search-console': {
                await sql`DELETE FROM mb_sync_state WHERE sync_type IN ('search_console', 'search_console_backfill_progress')`;
                await sql`DELETE FROM search_console_daily`;
                return NextResponse.json({ action, message: 'Search console data and sync state cleared.' });
            }
            case 'sync-zenoti': {
                const result = await incrementalZenotiSync();
                return NextResponse.json({ action, ...result });
            }
            default:
                return NextResponse.json({
                    error: `Unknown action: ${action}`,
                    validActions: [
                        'backfill-sales', 'backfill-appointments', 'backfill-clients',
                        'backfill-mindbody', 'backfill-ghl', 'reset-ghl',
                        'backfill-social', 'backfill-search-console',
                        'rebackfill-columns',
                        'sync', 'sync-mindbody', 'sync-ghl', 'sync-social', 'sync-search-console',
                        'reset-social', 'reset-search-console',
                        'sync-zenoti',
                    ],
                }, { status: 400 });
        }
    } catch (error: unknown) {
        console.error(`[data-sync] Error for action=${action}:`, error);
        const message = error instanceof Error ? error.message : 'Sync failed';
        return NextResponse.json({ error: message, action }, { status: 500 });
    }
}
