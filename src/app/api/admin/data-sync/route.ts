/**
 * /api/admin/data-sync
 * Admin-only route for MindBody + GHL data synchronization.
 * GET: Returns sync status (record counts, last sync dates, match rate)
 * POST: Triggers backfill or incremental sync
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
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

export const maxDuration = 300; // 5 min — backfill can take a while

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
                return NextResponse.json({ action, ...result });
            }
            case 'backfill-mindbody': {
                // Run all 3 MindBody backfills sequentially
                const sales = await backfillSales(startYear || 2020);
                const appts = await backfillAppointments(startYear || 2020);
                const clients = await backfillClients();
                return NextResponse.json({
                    action,
                    sales,
                    appointments: appts,
                    clients,
                    totalApiCalls: sales.apiCalls + appts.apiCalls + clients.apiCalls,
                });
            }
            case 'backfill-ghl': {
                const result = await backfillGhlContacts();
                return NextResponse.json({ action, ...result });
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
                        'backfill-mindbody', 'backfill-ghl',
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
