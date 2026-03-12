/**
 * /api/admin/data-sync
 * Admin-only route for MindBody + GHL data synchronization.
 * GET: Returns sync status (record counts, last sync dates, match rate)
 * POST: Triggers backfill or incremental sync
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sql } from '@vercel/postgres';
import {
    backfillSales,
    backfillAppointments,
    backfillClients,
    incrementalSync,
    getSyncStats,
    getAvailableTreatments,
} from '@/lib/integrations/mindbody-sync';
import {
    backfillGhlContacts,
    incrementalGhlSync,
    getGhlSyncStats,
} from '@/lib/integrations/ghl-contacts-sync';

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

    // Return full sync status
    const [mbStats, ghlStats] = await Promise.all([
        getSyncStats(),
        getGhlSyncStats(),
    ]);

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
            default:
                return NextResponse.json({
                    error: `Unknown action: ${action}`,
                    validActions: [
                        'backfill-sales', 'backfill-appointments', 'backfill-clients',
                        'backfill-mindbody', 'backfill-ghl', 'reset-ghl',
                        'sync', 'sync-mindbody', 'sync-ghl',
                    ],
                }, { status: 400 });
        }
    } catch (error: unknown) {
        console.error(`[data-sync] Error for action=${action}:`, error);
        const message = error instanceof Error ? error.message : 'Sync failed';
        return NextResponse.json({ error: message, action }, { status: 500 });
    }
}
