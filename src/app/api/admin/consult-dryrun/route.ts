/**
 * TEMPORARY dry-run diff for the refined "Consulted, Not Treated" segment.
 * Compares OLD (revenue==0) vs NEW (item-type classifier + 12mo treatment) logic
 * on the same fetched data, and explains every difference.
 *
 * DELETE THIS ROUTE after the criteria change is reviewed and shipped.
 * Guarded by ?secret=CRON_SECRET. Run locally against the dev server.
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getAppointments, getPurchasingClients, type StaffAppointment } from '@/lib/integrations/mindbody';
import { isTreatmentSale, isFollowUpSale } from '@/lib/integrations/ghl-conversations';
import { sql } from '@/lib/db/sql';

type Item = { IsService?: boolean; TotalAmount?: number; Description?: string };

export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const now = Date.now();
    const startDate = new Date(now - 180 * 86400000).toISOString().split('T')[0];
    const endDate = new Date().toISOString().split('T')[0];
    const sevenDaysAgo = new Date(now - 7 * 86400000).toISOString().split('T')[0];
    const SKIP_SESSION = /follow.?up|block|unavailable/i;

    const [appointments, purchasingData] = await Promise.all([
        getAppointments(startDate, endDate),
        getPurchasingClients(startDate, endDate),
    ]);

    // Per-day revenue (OLD) + per-day items (NEW), plus all sales per client.
    const revenueByDate = new Map<string, number>();
    const itemsByDate = new Map<string, Item[]>();
    const salesByClient = new Map<string, Array<{ date: string; revenue: number; items: Item[] }>>();

    for (const sale of purchasingData.sales) {
        if (!sale.ClientId) continue;
        const d = (sale.SaleDate || sale.SaleDateTime || '').split('T')[0];
        if (!d) continue;
        const items = (sale.PurchasedItems || []) as Item[];
        const rev = items.reduce((s, i) => s + (i.TotalAmount || 0), 0);
        const key = `${sale.ClientId}_${d}`;
        revenueByDate.set(key, (revenueByDate.get(key) || 0) + rev);
        const bucket = itemsByDate.get(key) || [];
        bucket.push(...items);
        itemsByDate.set(key, bucket);
        if (!salesByClient.has(sale.ClientId)) salesByClient.set(sale.ClientId, []);
        salesByClient.get(sale.ClientId)!.push({ date: d, revenue: rev, items });
    }

    // --- Candidate detection (most-recent qualifying appt per client) ---
    const oldCand = new Map<string, StaffAppointment>();
    const newCand = new Map<string, StaffAppointment>();
    const newDropReason = new Map<string, string>(); // why a consult candidate failed in NEW

    for (const appt of appointments) {
        const status = (appt.Status || '').toLowerCase();
        if (status !== 'completed' && status !== 'arrived') continue;
        if (!appt.ClientId) continue;
        if (SKIP_SESSION.test(appt.SessionType?.Name || '')) continue;
        const d = (appt.StartDateTime || '').split('T')[0];
        if (d > sevenDaysAgo) continue;

        const key = `${appt.ClientId}_${d}`;
        const items = itemsByDate.get(key);

        // OLD: qualifies if day revenue == 0
        if ((revenueByDate.get(key) || 0) === 0) {
            const ex = oldCand.get(appt.ClientId);
            if (!ex || appt.StartDateTime > ex.StartDateTime) oldCand.set(appt.ClientId, appt);
        }

        // NEW: qualifies if not a treatment sale and not a follow-up sale that day
        if (isTreatmentSale(items)) {
            newDropReason.set(appt.ClientId, `visit-day treatment: ${(items || []).map(i => i.Description).join(', ')}`);
            continue;
        }
        if (isFollowUpSale(items)) {
            newDropReason.set(appt.ClientId, `visit-day follow-up line`);
            continue;
        }
        const ex = newCand.get(appt.ClientId);
        if (!ex || appt.StartDateTime > ex.StartDateTime) newCand.set(appt.ClientId, appt);
    }

    // --- Exclusion: OLD = any revenue>0 in 180d; NEW = treatment in 12mo ---
    const oldSet = new Set<string>();
    for (const id of oldCand.keys()) {
        const hasRev = (salesByClient.get(id) || []).some(s => s.revenue > 0);
        if (!hasRev) oldSet.add(id);
    }

    // NEW 12mo treatment via Postgres
    const candidateIds = [...newCand.keys()];
    const cutoff = new Date(now - 12 * 30 * 86400000).toISOString().split('T')[0];
    const treated12mo = new Map<string, { date: string; desc: string }>();
    if (candidateIds.length) {
        const rows = await sql`
            SELECT client_id, sale_date, items_json
            FROM mb_sales_history
            WHERE client_id = ANY(${candidateIds}) AND sale_date >= ${cutoff}
            ORDER BY sale_date DESC
        `;
        for (const r of rows.rows) {
            if (treated12mo.has(r.client_id)) continue;
            let items: Item[] = [];
            try { const p = typeof r.items_json === 'string' ? JSON.parse(r.items_json) : r.items_json; if (Array.isArray(p)) items = p; } catch {}
            if (isTreatmentSale(items)) treated12mo.set(r.client_id, { date: String(r.sale_date).split('T')[0], desc: items.map(i => i.Description).filter(Boolean).join(', ') });
        }
    }
    // also live-180d treatment
    const liveTreated = new Set<string>();
    for (const [id, sales] of salesByClient) if (sales.some(s => isTreatmentSale(s.items))) liveTreated.add(id);

    const newSet = new Set<string>();
    for (const id of newCand.keys()) {
        if (treated12mo.has(id) || liveTreated.has(id)) continue;
        newSet.add(id);
    }

    // --- Diff ---
    const nameOf = (id: string) => {
        const a = oldCand.get(id) || newCand.get(id);
        return `${a?.Client?.FirstName || ''} ${a?.Client?.LastName || ''}`.trim() || id;
    };
    const dropped = [...oldSet].filter(id => !newSet.has(id)).map(id => {
        let reason = newDropReason.get(id);
        if (!reason) {
            const t = treated12mo.get(id);
            if (t) reason = `treated within 12mo (${t.date}: ${t.desc})`;
            else if (liveTreated.has(id)) reason = `treated within 180d (live sale)`;
            else reason = 'no longer a consult candidate';
        }
        return { client: nameOf(id), mbClientId: id, reason };
    });
    const added = [...newSet].filter(id => !oldSet.has(id)).map(id => ({ client: nameOf(id), mbClientId: id }));

    // Named sanity checks
    const watch = ['Guidry', 'Amina', 'Pooja', 'Gee'];
    const watchResults = watch.map(name => {
        const id = [...oldCand.keys(), ...newCand.keys()].find(i => nameOf(i).toLowerCase().includes(name.toLowerCase()));
        if (!id) return { name, found: false };
        return { name, found: true, client: nameOf(id), inOld: oldSet.has(id), inNew: newSet.has(id), reason: newDropReason.get(id) || (treated12mo.get(id) ? `treated 12mo ${treated12mo.get(id)!.date}` : liveTreated.has(id) ? 'treated 180d' : '') };
    });

    return NextResponse.json({
        window: { startDate, endDate },
        counts: { oldTotal: oldSet.size, newTotal: newSet.size, dropped: dropped.length, added: added.length },
        watchResults,
        dropped: dropped.slice(0, 80),
        added: added.slice(0, 80),
    }, { status: 200 });
}
