/**
 * /api/admin/data-sync
 * Admin-only route for MindBody + GHL data synchronization.
 * GET: Returns sync status (record counts, last sync dates, match rate)
 * POST: Triggers backfill or incremental sync
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sql } from '@/lib/db/sql';
import {
    backfillSales,
    backfillAppointments,
    backfillClients,
    getSyncStats,
    getAvailableTreatments,
    rebackfillClientColumns,
} from '@/lib/integrations/mindbody-sync';
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
import {
    migrateSchemaForZenoti,
    backfillZenotiSales,
    backfillZenotiAppointments,
    backfillZenotiGuests,
    incrementalZenotiSync,
} from '@/lib/integrations/zenoti-sync';

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
    const { action, startYear } = body as { action: string; startYear?: number };

    try {
        switch (action) {
            case 'backfill-sales': {
                const result = await backfillSales(startYear || 2020);
                return NextResponse.json({ action, ...result });
            }
            case 'backfill-appointments': {
                const result = await backfillAppointments(startYear || 2020);
                return NextResponse.json({ action, ...result });
            }
            case 'backfill-clients': {
                const result = await backfillClients();
                return NextResponse.json({ action, ...result, continue: !result.done });
            }
            case 'backfill-mindbody': {
                // Step through one chunk at a time (Vercel 60s limit).
                // Phase 1: sales chunks, Phase 2: appointment chunks, Phase 3: clients.
                // UI should auto-loop while `continue: true`.
                const salesResult = await backfillSales(startYear || 2020);
                if (!salesResult.done) {
                    return NextResponse.json({
                        action, phase: 'sales', ...salesResult, continue: true,
                    });
                }
                const apptsResult = await backfillAppointments(startYear || 2020);
                if (!apptsResult.done) {
                    return NextResponse.json({
                        action, phase: 'appointments', ...apptsResult, continue: true,
                    });
                }
                const clientsResult = await backfillClients();
                if (!clientsResult.done) {
                    return NextResponse.json({
                        action, phase: 'clients', ...clientsResult, continue: true,
                    });
                }
                return NextResponse.json({
                    action, phase: 'clients', ...clientsResult, continue: false,
                    chunkLabel: 'All MindBody backfill complete',
                });
            }
            case 'backfill-ghl': {
                const result = await backfillGhlContacts();
                return NextResponse.json({ action, ...result, continue: !result.done });
            }
            case 'reset-mindbody': {
                await sql`DELETE FROM mb_sync_state WHERE sync_type IN ('sales', 'appointments', 'clients', 'sales_backfill_progress', 'appts_backfill_progress', 'clients_backfill_progress')`;
                await sql`DELETE FROM mb_sales_history`;
                await sql`DELETE FROM mb_appointments_history`;
                await sql`DELETE FROM mb_clients_cache`;
                return NextResponse.json({ action, message: 'MindBody data and sync state cleared. Run backfill again.' });
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
            case 'rebackfill-columns': {
                // Ensure new columns exist (runs migration if not already applied)
                await sql`ALTER TABLE mb_clients_cache ADD COLUMN IF NOT EXISTS referred_by TEXT`;
                await sql`ALTER TABLE mb_clients_cache ADD COLUMN IF NOT EXISTS creation_date TIMESTAMPTZ`;
                await sql`ALTER TABLE mb_sales_history ADD COLUMN IF NOT EXISTS payments_total NUMERIC(10,2) DEFAULT 0`;
                // Targeted client re-fetch: updates referred_by + creation_date
                // for existing clients where those columns are NULL.
                // Sales don't need re-fetching — revenue queries fall back to total_amount.
                // ~633 API calls (6,372 clients ÷ 10 per batch), 200 clients per invocation.
                // Restore sales sync state if it was deleted by a previous failed attempt
                const salesState = await sql`SELECT 1 FROM mb_sync_state WHERE sync_type = 'sales'`;
                if (salesState.rows.length === 0) {
                    await sql`
                        INSERT INTO mb_sync_state (sync_type, last_sync_date, total_records, updated_at)
                        VALUES ('sales', ${new Date().toISOString().split('T')[0]}, (SELECT COUNT(*) FROM mb_sales_history), NOW())
                        ON CONFLICT (sync_type) DO NOTHING
                    `;
                }
                // Restore clients sync state if it was deleted by a previous failed attempt
                const clientsState = await sql`SELECT 1 FROM mb_sync_state WHERE sync_type = 'clients'`;
                if (clientsState.rows.length === 0) {
                    await sql`
                        INSERT INTO mb_sync_state (sync_type, last_sync_date, total_records, updated_at)
                        VALUES ('clients', ${new Date().toISOString().split('T')[0]}, (SELECT COUNT(*) FROM mb_clients_cache), NOW())
                        ON CONFLICT (sync_type) DO NOTHING
                    `;
                }
                const result = await rebackfillClientColumns();
                return NextResponse.json({ action, phase: 'clients', ...result, continue: !result.done });
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
            // ---------------- Zenoti cutover (2026-07-01) ----------------
            case 'migrate-zenoti-schema': {
                // One-time: widen sale_id/appointment_id INTEGER→TEXT + add source column.
                // Idempotent — no-ops once applied.
                const result = await migrateSchemaForZenoti();
                return NextResponse.json({
                    action,
                    changed: result.changed,
                    message: result.changed.length
                        ? `Schema migrated: ${result.changed.join(', ')}`
                        : 'Schema already migrated (no changes).',
                });
            }
            case 'purge-mindbody-post-cutover': {
                // Enforce the locked seam: MindBody authoritative ≤ 6/30, Zenoti owns 7/1→.
                // Removes the 4 $0 sale stragglers dated > 6/30 and the 72 appointment rows
                // dated ≥ 7/1 (false NoShows + migrated future bookings). 6/30-and-earlier stays.
                const sales = await sql`
                    DELETE FROM mb_sales_history
                    WHERE sale_date > '2026-06-30'
                    RETURNING sale_id, sale_date, total_amount
                `;
                const appts = await sql`
                    DELETE FROM mb_appointments_history
                    WHERE (start_date AT TIME ZONE 'America/New_York')::date >= '2026-07-01'
                    RETURNING appointment_id, start_date, status
                `;
                return NextResponse.json({
                    action,
                    salesDeleted: sales.rowCount,
                    apptsDeleted: appts.rowCount,
                    sampleSales: sales.rows.slice(0, 5),
                    message: `Purged ${sales.rowCount} post-6/30 sales + ${appts.rowCount} ≥7/1 appointments.`,
                });
            }
            case 'backfill-zenoti-sales': {
                const result = await backfillZenotiSales();
                return NextResponse.json({ action, ...result });
            }
            case 'backfill-zenoti-appointments': {
                const result = await backfillZenotiAppointments();
                return NextResponse.json({ action, ...result });
            }
            case 'backfill-zenoti-guests': {
                // Resumable: processes ≤40 sales-only guests per call. Loop while continue:true.
                const result = await backfillZenotiGuests();
                return NextResponse.json({ action, ...result, continue: !result.done });
            }
            case 'backfill-zenoti': {
                // Full cutover in one entrypoint (UI auto-loops while continue:true):
                //   migrate schema → purge post-cutover MB → sales → appointments → guests (chunked).
                const migration = await migrateSchemaForZenoti();
                const salesPurge = await sql`DELETE FROM mb_sales_history WHERE sale_date > '2026-06-30' RETURNING sale_id`;
                const apptPurge = await sql`
                    DELETE FROM mb_appointments_history
                    WHERE (start_date AT TIME ZONE 'America/New_York')::date >= '2026-07-01'
                    RETURNING appointment_id
                `;
                const sales = await backfillZenotiSales();
                const appts = await backfillZenotiAppointments();
                const guests = await backfillZenotiGuests();
                return NextResponse.json({
                    action,
                    phase: 'guests',
                    migration: migration.changed,
                    purged: { sales: salesPurge.rowCount, appts: apptPurge.rowCount },
                    sales: sales.label,
                    appointments: appts.label,
                    guests: guests.label,
                    continue: !guests.done,
                    chunkLabel: guests.done
                        ? 'Zenoti cutover backfill complete'
                        : 'Zenoti guests still backfilling — loop again',
                });
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
                        'migrate-zenoti-schema', 'purge-mindbody-post-cutover',
                        'backfill-zenoti-sales', 'backfill-zenoti-appointments', 'backfill-zenoti-guests',
                        'backfill-zenoti', 'sync-zenoti',
                    ],
                }, { status: 400 });
        }
    } catch (error: unknown) {
        console.error(`[data-sync] Error for action=${action}:`, error);
        const message = error instanceof Error ? error.message : 'Sync failed';
        return NextResponse.json({ error: message, action }, { status: 500 });
    }
}
