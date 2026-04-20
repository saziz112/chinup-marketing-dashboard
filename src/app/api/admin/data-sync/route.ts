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
    incrementalSync,
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

export const maxDuration = 60; // Vercel Hobby limit

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
            case 'sync': {
                // Incremental sync for both MindBody and GHL
                const [mb, ghl] = await Promise.all([
                    incrementalSync(),
                    incrementalGhlSync(),
                ]);
                return NextResponse.json({
                    action,
                    mindbody: mb,
                    ghl,
                    totalApiCalls: mb.apiCalls + ghl.apiCalls,
                });
            }
            case 'sync-mindbody': {
                const result = await incrementalSync();
                return NextResponse.json({ action, ...result });
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
                    ],
                }, { status: 400 });
        }
    } catch (error: unknown) {
        console.error(`[data-sync] Error for action=${action}:`, error);
        const message = error instanceof Error ? error.message : 'Sync failed';
        return NextResponse.json({ error: message, action }, { status: 500 });
    }
}
