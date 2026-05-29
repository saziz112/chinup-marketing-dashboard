/**
 * TEMPORARY dry-run for the refined "Cancelled / No-Show, Didn't Rebook" segment.
 * Shows who's eligible and who's excluded (rebooked / came back / purchased since)
 * with counts + samples, so we can validate before shipping.
 *
 * DELETE THIS ROUTE after review. Session-guarded; hit it logged in.
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getAppointments, getPurchasingClients, type StaffAppointment } from '@/lib/integrations/mindbody';

export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const now = Date.now();
    const startDate = new Date(now - 180 * 86400000).toISOString().split('T')[0];
    const endDate = new Date().toISOString().split('T')[0];
    const apptEndDate = new Date(now + 180 * 86400000).toISOString().split('T')[0];
    const todayISO = new Date().toISOString();
    const lookbackStart = new Date(now - 548 * 86400000).toISOString().split('T')[0];
    const CANCEL_RE = /cancel|no.?show|missed/i;

    const [appointments, purchasing] = await Promise.all([
        getAppointments(startDate, apptEndDate),
        getPurchasingClients(lookbackStart, endDate).catch(() => ({ clients: [], sales: [] as never[] })),
    ]);

    const cancelByClient = new Map<string, StaffAppointment>();
    const lastCompletedByClient = new Map<string, string>();
    const futureBookedByClient = new Set<string>();

    for (const appt of appointments) {
        if (!appt.ClientId) continue;
        const status = (appt.Status || '').toLowerCase();
        const start = appt.StartDateTime || '';
        if (status === 'completed' || status === 'arrived') {
            const ex = lastCompletedByClient.get(appt.ClientId);
            if (!ex || start > ex) lastCompletedByClient.set(appt.ClientId, start);
        } else if ((status === 'booked' || status === 'confirmed') && start > todayISO) {
            futureBookedByClient.add(appt.ClientId);
        } else if (CANCEL_RE.test(status) && start <= todayISO) {
            const ex = cancelByClient.get(appt.ClientId);
            if (!ex || start > ex.StartDateTime) cancelByClient.set(appt.ClientId, appt);
        }
    }

    const lastSaleByClient = new Map<string, string>();
    for (const sale of purchasing.sales as Array<{ ClientId?: string; SaleDate?: string; SaleDateTime?: string }>) {
        if (!sale.ClientId) continue;
        const d = (sale.SaleDate || sale.SaleDateTime || '').split('T')[0];
        if (!d) continue;
        const ex = lastSaleByClient.get(sale.ClientId);
        if (!ex || d > ex) lastSaleByClient.set(sale.ClientId, d);
    }

    const name = (a: StaffAppointment) => `${a.Client?.FirstName || ''} ${a.Client?.LastName || ''}`.trim() || a.ClientId!;
    const eligible: object[] = [];
    const exRebooked: object[] = [];
    const exCameBack: object[] = [];
    const exPurchased: object[] = [];

    for (const [clientId, appt] of cancelByClient) {
        const cancelDay = appt.StartDateTime.split('T')[0];
        const row = { client: name(appt), status: appt.Status, service: appt.SessionType?.Name || '', cancelDate: cancelDay };
        if (futureBookedByClient.has(clientId)) { exRebooked.push(row); continue; }
        const completedDay = lastCompletedByClient.get(clientId)?.split('T')[0];
        if (completedDay && completedDay >= cancelDay) { exCameBack.push({ ...row, completedDate: completedDay }); continue; }
        const saleDay = lastSaleByClient.get(clientId);
        if (saleDay && saleDay >= cancelDay) { exPurchased.push({ ...row, saleDate: saleDay }); continue; }
        eligible.push(row);
    }

    return NextResponse.json({
        window: { cancelLookback: startDate, futureWindow: apptEndDate },
        counts: {
            totalCancelClients: cancelByClient.size,
            eligible: eligible.length,
            excludedRebooked: exRebooked.length,
            excludedCameBack: exCameBack.length,
            excludedPurchased: exPurchased.length,
        },
        eligibleSample: eligible.slice(0, 40),
        excludedRebookedSample: exRebooked.slice(0, 15),
        excludedCameBackSample: exCameBack.slice(0, 15),
        excludedPurchasedSample: exPurchased.slice(0, 15),
    });
}
