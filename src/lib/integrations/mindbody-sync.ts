/**
 * MindBody Historical Data Sync
 * One-time backfill + daily incremental sync for sales & appointments.
 * Stores data in Vercel Postgres for unlimited lookback without API cost.
 */

import { sql } from '@/lib/db/sql';
import { getSales, getAppointments, getClients, normalizePhone } from './mindbody';
import type { Sale, StaffAppointment, Client } from './mindbody';
import { normalizeTreatment } from '@/lib/treatments';

// ---------------------------------------------------------------------------
// Sync State Helpers
// ---------------------------------------------------------------------------

export interface SyncState {
    syncType: string;
    lastSyncDate: string;
    totalRecords: number;
    updatedAt: string;
}

export async function getSyncState(): Promise<SyncState[]> {
    try {
        const result = await sql`SELECT sync_type, last_sync_date, total_records, updated_at FROM mb_sync_state`;
        return result.rows.map(r => ({
            syncType: r.sync_type,
            lastSyncDate: r.last_sync_date,
            totalRecords: r.total_records,
            updatedAt: r.updated_at,
        }));
    } catch {
        return [];
    }
}

export async function hasSyncData(): Promise<boolean> {
    try {
        const result = await sql`SELECT COUNT(*) as cnt FROM mb_sync_state`;
        return Number(result.rows[0]?.cnt) > 0;
    } catch {
        return false;
    }
}

// ---------------------------------------------------------------------------
// MindBody Sales Backfill
// ---------------------------------------------------------------------------

/**
 * Backfill MindBody sales — ONE 3-month chunk per call (Vercel 60s limit).
 * Returns `done: false` if more chunks remain. Caller should loop.
 */
export async function backfillSales(startYear: number = 2020): Promise<{ total: number; apiCalls: number; done: boolean; chunkLabel: string }> {
    const now = new Date();

    // If already completed (final 'sales' state exists), skip entirely
    const finalState = await sql`SELECT 1 FROM mb_sync_state WHERE sync_type = 'sales'`;
    if (finalState.rows.length > 0) {
        return { total: 0, apiCalls: 0, done: true, chunkLabel: 'Sales backfill already complete' };
    }

    // Check where we left off
    const progressResult = await sql`SELECT last_sync_date FROM mb_sync_state WHERE sync_type = 'sales_backfill_progress'`;
    let chunkStart: Date;
    if (progressResult.rows.length > 0) {
        // Resume from where we left off
        const lastDate = new Date(progressResult.rows[0]?.last_sync_date || `${startYear}-01-01`);
        chunkStart = new Date(lastDate);
        chunkStart.setDate(chunkStart.getDate() + 1);
    } else {
        chunkStart = new Date(`${startYear}-01-01`);
    }

    if (chunkStart >= now) {
        // All done — finalize
        await sql`
            INSERT INTO mb_sync_state (sync_type, last_sync_date, total_records, updated_at)
            VALUES ('sales', ${now.toISOString().split('T')[0]}, (SELECT COUNT(*) FROM mb_sales_history), NOW())
            ON CONFLICT (sync_type) DO UPDATE SET
                last_sync_date = ${now.toISOString().split('T')[0]},
                total_records = (SELECT COUNT(*) FROM mb_sales_history),
                updated_at = NOW()
        `;
        // Clean up progress tracker
        await sql`DELETE FROM mb_sync_state WHERE sync_type = 'sales_backfill_progress'`;
        return { total: 0, apiCalls: 0, done: true, chunkLabel: 'Complete' };
    }

    // Process ONE 3-month chunk
    const chunkEnd = new Date(chunkStart);
    chunkEnd.setMonth(chunkEnd.getMonth() + 3);
    if (chunkEnd > now) chunkEnd.setTime(now.getTime());

    const startDate = chunkStart.toISOString().split('T')[0];
    const endDate = chunkEnd.toISOString().split('T')[0];
    const chunkLabel = `Sales: ${startDate} → ${endDate}`;

    console.log(`[mb-sync] Fetching sales ${startDate} to ${endDate}...`);
    const sales = await getSales(startDate, endDate);
    const apiCalls = Math.ceil(sales.length / 100) || 1;
    let totalInserted = 0;

    if (sales.length > 0) {
        totalInserted = await upsertSales(sales);
        console.log(`[mb-sync] Inserted ${totalInserted} sales for ${startDate} to ${endDate}`);
    }

    // Save progress
    await sql`
        INSERT INTO mb_sync_state (sync_type, last_sync_date, total_records, updated_at)
        VALUES ('sales_backfill_progress', ${endDate}, ${totalInserted}, NOW())
        ON CONFLICT (sync_type) DO UPDATE SET
            last_sync_date = ${endDate},
            total_records = mb_sync_state.total_records + ${totalInserted},
            updated_at = NOW()
    `;

    const moreChunks = new Date(chunkEnd) < now;
    return { total: totalInserted, apiCalls, done: !moreChunks, chunkLabel };
}

// ---------------------------------------------------------------------------
// MindBody Appointments Backfill
// ---------------------------------------------------------------------------

/**
 * Backfill MindBody appointments — ONE 3-month chunk per call.
 * Returns `done: false` if more chunks remain. Caller should loop.
 */
export async function backfillAppointments(startYear: number = 2020): Promise<{ total: number; apiCalls: number; done: boolean; chunkLabel: string }> {
    const now = new Date();

    // If already completed (final 'appointments' state exists), skip entirely
    const finalState = await sql`SELECT 1 FROM mb_sync_state WHERE sync_type = 'appointments'`;
    if (finalState.rows.length > 0) {
        return { total: 0, apiCalls: 0, done: true, chunkLabel: 'Appointments backfill already complete' };
    }

    const progressResult = await sql`SELECT last_sync_date FROM mb_sync_state WHERE sync_type = 'appts_backfill_progress'`;
    let chunkStart: Date;
    if (progressResult.rows.length > 0) {
        const lastDate = new Date(progressResult.rows[0]?.last_sync_date || `${startYear}-01-01`);
        chunkStart = new Date(lastDate);
        chunkStart.setDate(chunkStart.getDate() + 1);
    } else {
        chunkStart = new Date(`${startYear}-01-01`);
    }

    if (chunkStart >= now) {
        await sql`
            INSERT INTO mb_sync_state (sync_type, last_sync_date, total_records, updated_at)
            VALUES ('appointments', ${now.toISOString().split('T')[0]}, (SELECT COUNT(*) FROM mb_appointments_history), NOW())
            ON CONFLICT (sync_type) DO UPDATE SET
                last_sync_date = ${now.toISOString().split('T')[0]},
                total_records = (SELECT COUNT(*) FROM mb_appointments_history),
                updated_at = NOW()
        `;
        await sql`DELETE FROM mb_sync_state WHERE sync_type = 'appts_backfill_progress'`;
        return { total: 0, apiCalls: 0, done: true, chunkLabel: 'Complete' };
    }

    const chunkEnd = new Date(chunkStart);
    chunkEnd.setMonth(chunkEnd.getMonth() + 3);
    if (chunkEnd > now) chunkEnd.setTime(now.getTime());

    const startDate = chunkStart.toISOString().split('T')[0];
    const endDate = chunkEnd.toISOString().split('T')[0];
    const chunkLabel = `Appointments: ${startDate} → ${endDate}`;

    console.log(`[mb-sync] Fetching appointments ${startDate} to ${endDate}...`);
    const appts = await getAppointments(startDate, endDate);
    const apiCalls = Math.ceil(appts.length / 100) || 1;
    let totalInserted = 0;

    if (appts.length > 0) {
        totalInserted = await upsertAppointments(appts);
        console.log(`[mb-sync] Inserted ${totalInserted} appointments for ${startDate} to ${endDate}`);
    }

    await sql`
        INSERT INTO mb_sync_state (sync_type, last_sync_date, total_records, updated_at)
        VALUES ('appts_backfill_progress', ${endDate}, ${totalInserted}, NOW())
        ON CONFLICT (sync_type) DO UPDATE SET
            last_sync_date = ${endDate},
            total_records = mb_sync_state.total_records + ${totalInserted},
            updated_at = NOW()
    `;

    const moreChunks = new Date(chunkEnd) < now;
    return { total: totalInserted, apiCalls, done: !moreChunks, chunkLabel };
}

// ---------------------------------------------------------------------------
// MindBody Client Backfill (for phone/email matching)
// ---------------------------------------------------------------------------

/**
 * Backfill client details — ONE chunk of ~200 clients per call (Vercel 60s limit).
 * Pulls unique client IDs from BOTH sales and appointments history.
 * Returns `done: false` if more remain. Caller should loop.
 */
export async function backfillClients(): Promise<{ total: number; apiCalls: number; done: boolean; chunkLabel: string }> {
    const CHUNK_SIZE = 200; // 200 clients ÷ 10 per API call = 20 API calls ≈ 10-15s

    // If already completed (final 'clients' state exists), skip entirely
    const finalState = await sql`SELECT 1 FROM mb_sync_state WHERE sync_type = 'clients'`;
    if (finalState.rows.length > 0) {
        return { total: 0, apiCalls: 0, done: true, chunkLabel: 'Clients backfill already complete' };
    }

    // Get offset from progress tracker
    const progressResult = await sql`SELECT total_records FROM mb_sync_state WHERE sync_type = 'clients_backfill_progress'`;
    const offset = progressResult.rows.length > 0 ? Number(progressResult.rows[0].total_records) : 0;

    // Get all unique client IDs from sales + appointments not yet in cache
    const result = await sql`
        SELECT DISTINCT client_id FROM (
            SELECT DISTINCT client_id FROM mb_sales_history
            UNION
            SELECT DISTINCT client_id FROM mb_appointments_history
        ) all_clients
        WHERE client_id NOT IN (SELECT client_id FROM mb_clients_cache)
        ORDER BY client_id
        LIMIT ${CHUNK_SIZE}
    `;
    const clientIds = result.rows.map(r => String(r.client_id));

    if (clientIds.length === 0) {
        // All done — finalize
        await sql`
            INSERT INTO mb_sync_state (sync_type, last_sync_date, total_records, updated_at)
            VALUES ('clients', ${new Date().toISOString().split('T')[0]}, (SELECT COUNT(*) FROM mb_clients_cache), NOW())
            ON CONFLICT (sync_type) DO UPDATE SET
                last_sync_date = ${new Date().toISOString().split('T')[0]},
                total_records = (SELECT COUNT(*) FROM mb_clients_cache),
                updated_at = NOW()
        `;
        await sql`DELETE FROM mb_sync_state WHERE sync_type = 'clients_backfill_progress'`;
        console.log('[mb-sync] Client backfill complete');
        return { total: 0, apiCalls: 0, done: true, chunkLabel: 'Complete' };
    }

    const chunkLabel = `Clients: batch ${Math.floor(offset / CHUNK_SIZE) + 1} (${clientIds.length} clients)`;
    console.log(`[mb-sync] ${chunkLabel}`);

    const clients = await getClients(clientIds);
    const apiCalls = Math.ceil(clientIds.length / 10);

    if (clients.length > 0) {
        await upsertClients(clients);
    }

    // Save progress (track total fetched so far for the label)
    const newTotal = offset + clientIds.length;
    await sql`
        INSERT INTO mb_sync_state (sync_type, last_sync_date, total_records, updated_at)
        VALUES ('clients_backfill_progress', ${new Date().toISOString().split('T')[0]}, ${newTotal}, NOW())
        ON CONFLICT (sync_type) DO UPDATE SET
            total_records = ${newTotal},
            updated_at = NOW()
    `;

    console.log(`[mb-sync] Fetched ${clients.length} clients (${newTotal} total so far), ${apiCalls} API calls`);
    return { total: clients.length, apiCalls, done: false, chunkLabel };
}

// ---------------------------------------------------------------------------
// Re-fetch existing clients (updates referred_by + creation_date columns)
// ---------------------------------------------------------------------------

/**
 * Re-fetch clients already in mb_clients_cache where referred_by IS NULL.
 * Updates existing rows with referred_by + creation_date from the API.
 * Processes 200 clients per invocation. Returns done: false if more remain.
 */
export async function rebackfillClientColumns(): Promise<{ total: number; apiCalls: number; done: boolean; chunkLabel: string }> {
    const CHUNK_SIZE = 200;

    // Find clients missing the new columns
    const result = await sql`
        SELECT client_id FROM mb_clients_cache
        WHERE referred_by IS NULL
        ORDER BY client_id
        LIMIT ${CHUNK_SIZE}
    `;
    const clientIds = result.rows.map(r => String(r.client_id));

    if (clientIds.length === 0) {
        return { total: 0, apiCalls: 0, done: true, chunkLabel: 'All client columns updated' };
    }

    const remaining = await sql`SELECT COUNT(*) as cnt FROM mb_clients_cache WHERE referred_by IS NULL`;
    const remainingCount = Number(remaining.rows[0]?.cnt || 0);
    const chunkLabel = `Updating ${clientIds.length} clients (${remainingCount} remaining)`;
    console.log(`[mb-sync] ${chunkLabel}`);

    const clients = await getClients(clientIds);
    const apiCalls = Math.ceil(clientIds.length / 10);

    if (clients.length > 0) {
        await upsertClients(clients);
    }

    // Check if there are more
    const moreResult = await sql`SELECT COUNT(*) as cnt FROM mb_clients_cache WHERE referred_by IS NULL`;
    const moreRemaining = Number(moreResult.rows[0]?.cnt || 0);

    return { total: clients.length, apiCalls, done: moreRemaining === 0, chunkLabel };
}

// ---------------------------------------------------------------------------
// Incremental Sync
// ---------------------------------------------------------------------------

/**
 * Fetch only new data since last sync. Safe to run frequently.
 * Overlaps by 2 days to catch any late-arriving records.
 */
export async function incrementalSync(): Promise<{
    newSales: number;
    newAppts: number;
    newClients: number;
    apiCalls: number;
}> {
    const states = await getSyncState();
    const salesState = states.find(s => s.syncType === 'sales');
    const apptsState = states.find(s => s.syncType === 'appointments');

    if (!salesState && !apptsState) {
        console.log('[mb-sync] No sync state found — run backfill first');
        return { newSales: 0, newAppts: 0, newClients: 0, apiCalls: 0 };
    }

    const now = new Date();
    const endDate = now.toISOString().split('T')[0];
    let apiCalls = 0;
    let newSales = 0;
    let newAppts = 0;

    // Sync sales (overlap by 2 days)
    if (salesState) {
        const syncFrom = new Date(salesState.lastSyncDate);
        syncFrom.setDate(syncFrom.getDate() - 2);
        const startDate = syncFrom.toISOString().split('T')[0];

        const sales = await getSales(startDate, endDate);
        apiCalls += Math.ceil(sales.length / 100) || 1;
        if (sales.length > 0) {
            newSales = await upsertSales(sales);
        }

        await sql`
            UPDATE mb_sync_state
            SET last_sync_date = ${endDate},
                total_records = (SELECT COUNT(*) FROM mb_sales_history),
                updated_at = NOW()
            WHERE sync_type = 'sales'
        `;
    }

    // Sync appointments (overlap by 2 days)
    if (apptsState) {
        const syncFrom = new Date(apptsState.lastSyncDate);
        syncFrom.setDate(syncFrom.getDate() - 2);
        const startDate = syncFrom.toISOString().split('T')[0];

        const appts = await getAppointments(startDate, endDate);
        apiCalls += Math.ceil(appts.length / 100) || 1;
        if (appts.length > 0) {
            newAppts = await upsertAppointments(appts);
        }

        await sql`
            UPDATE mb_sync_state
            SET last_sync_date = ${endDate},
                total_records = (SELECT COUNT(*) FROM mb_appointments_history),
                updated_at = NOW()
            WHERE sync_type = 'appointments'
        `;
    }

    // Sync any new clients not yet in cache (from new sales/appointments)
    let newClients = 0;
    const missingResult = await sql`
        SELECT DISTINCT client_id FROM (
            SELECT DISTINCT client_id FROM mb_sales_history
            UNION
            SELECT DISTINCT client_id FROM mb_appointments_history
        ) all_clients
        WHERE client_id NOT IN (SELECT client_id FROM mb_clients_cache)
        LIMIT 200
    `;
    const missingIds = missingResult.rows.map(r => String(r.client_id));
    if (missingIds.length > 0) {
        const clients = await getClients(missingIds);
        apiCalls += Math.ceil(missingIds.length / 10);
        if (clients.length > 0) {
            await upsertClients(clients);
            newClients = clients.length;
        }
    }

    console.log(`[mb-sync] Incremental sync: ${newSales} new sales, ${newAppts} new appointments, ${newClients} new clients, ${apiCalls} API calls`);
    return { newSales, newAppts, newClients, apiCalls };
}

// ---------------------------------------------------------------------------
// Lapsed Patients from Postgres (replaces API-based approach)
// ---------------------------------------------------------------------------

export interface LapsedPatientDB {
    mbClientId: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    totalRevenue: number;
    lastSaleDate: string;
    daysSinceLastVisit: number;
    segment: 'recent-lapse' | 'lapsed' | 'long-lapsed';
    lastTreatmentType?: string;
    lastTreatmentDate?: string;
    treatmentHistory?: string[];
}

/**
 * Query lapsed patients from Postgres (unlimited lookback, zero API calls).
 *
 * "Last visit" is MAX over sales AND completed/arrived appointments, so that
 * package redemptions, complimentary visits, and account-credit visits — none
 * of which generate a new sale row — correctly suppress the lapse flag. This
 * also covers cross-location visits (MindBody is one site; any location's
 * activity counts), which was the original motivation for the fix.
 *
 * Anyone with a future booking (status Booked/Confirmed, start_date > NOW())
 * is excluded — they're scheduled, not lapsed.
 *
 * Revenue is still computed from sales only; appointments don't add revenue.
 */
export async function getLapsedPatientsFromDB(
    minDaysSinceVisit: number = 60,
    treatmentFilter?: string,
): Promise<LapsedPatientDB[]> {
    // Unified activity view (sales + completed appointments) + revenue from sales +
    // exclude anyone with a future-booked appointment (they're scheduled, not lapsed).
    //
    // Identity merge: MindBody allows multiple client_ids per real person (name
    // variations, re-registrations), and post-2026-07-01 cutover a person's Zenoti
    // activity lives under a new GUID client_id. A person can be "lapsed" under one
    // client_id and "active" (or freshly rebooked) under another. `active_contacts`
    // and `future_contacts` gather phones/emails for anyone recently active OR with a
    // future booking; the `NOT EXISTS` checks exclude any lapsed client who shares a
    // phone OR email with them. (A client_id-only `future_booked` check missed Zenoti
    // rebookings — e.g. a MindBody-id patient booked under their Zenoti GUID — and
    // would text an already-scheduled patient a "we miss you" win-back.)
    const salesResult = await sql`
        WITH client_activity AS (
            SELECT client_id, sale_date AS activity_date FROM mb_sales_history
            UNION ALL
            SELECT client_id, start_date AS activity_date
            FROM mb_appointments_history
            WHERE status IN ('Completed', 'Arrived')
        ),
        revenue AS (
            SELECT client_id, SUM(total_amount) AS total_revenue
            FROM mb_sales_history
            GROUP BY client_id
        ),
        future_booked AS (
            SELECT DISTINCT client_id
            FROM mb_appointments_history
            WHERE status IN ('Booked', 'Confirmed')
              AND start_date > NOW()
        ),
        future_contacts AS (
            -- phones/emails of anyone with a future booking, so the peer-expanded
            -- NOT EXISTS below also suppresses a patient booked under a different
            -- identity (notably a Zenoti GUID after the cutover).
            SELECT DISTINCT
                NULLIF(LOWER(TRIM(c.email)), '') AS email,
                NULLIF(RIGHT(regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g'), 10), '') AS phone
            FROM mb_clients_cache c
            WHERE c.client_id IN (SELECT client_id FROM future_booked)
        ),
        active_contacts AS (
            SELECT DISTINCT
                NULLIF(LOWER(TRIM(c.email)), '') AS email,
                NULLIF(RIGHT(regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g'), 10), '') AS phone
            FROM mb_clients_cache c
            WHERE c.client_id IN (
                SELECT DISTINCT client_id
                FROM client_activity
                WHERE activity_date > NOW() - make_interval(days => ${minDaysSinceVisit})
            )
        )
        SELECT
            a.client_id,
            COALESCE(r.total_revenue, 0) AS total_revenue,
            MAX(a.activity_date) AS last_sale_date,
            EXTRACT(DAY FROM NOW() - MAX(a.activity_date))::INTEGER AS days_since
        FROM client_activity a
        LEFT JOIN revenue r ON r.client_id = a.client_id
        LEFT JOIN mb_clients_cache c ON c.client_id = a.client_id
        WHERE a.client_id NOT IN (SELECT client_id FROM future_booked)
          AND NOT EXISTS (
              SELECT 1 FROM future_contacts fc
              WHERE (
                  fc.phone IS NOT NULL
                  AND fc.phone = NULLIF(RIGHT(regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g'), 10), '')
              ) OR (
                  fc.email IS NOT NULL
                  AND fc.email = NULLIF(LOWER(TRIM(c.email)), '')
              )
          )
          AND NOT EXISTS (
              SELECT 1 FROM active_contacts ac
              WHERE (
                  ac.phone IS NOT NULL
                  AND ac.phone = NULLIF(RIGHT(regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g'), 10), '')
              ) OR (
                  ac.email IS NOT NULL
                  AND ac.email = NULLIF(LOWER(TRIM(c.email)), '')
              )
          )
        GROUP BY a.client_id, r.total_revenue
        HAVING EXTRACT(DAY FROM NOW() - MAX(a.activity_date))::INTEGER >= ${minDaysSinceVisit}
        ORDER BY COALESCE(r.total_revenue, 0) DESC
    `;

    if (salesResult.rows.length === 0) return [];

    // Treatment info comes from SALES line items (the appointments table has no
    // treatment names). Normalize each item description to a canonical clinical
    // treatment; most-recent = first qualifying item walking sales newest-first.
    const clientIds = salesResult.rows.map(r => r.client_id);
    const clientIdsCsv = clientIds.join(',');

    const treatmentMap = new Map<string, { name: string; date: string }>(); // most recent treatment
    const historyMap = new Map<string, string[]>();                          // distinct treatments

    if (clientIds.length > 0) {
        const itemRows = await sql`
            SELECT client_id, sale_date, items_json
            FROM mb_sales_history
            WHERE client_id = ANY(string_to_array(${clientIdsCsv}, ','))
              -- include legacy double-encoded ('string') rows; JS parse below unwraps them
              AND jsonb_typeof(items_json) IN ('array', 'string')
            ORDER BY sale_date DESC
        `;
        const histSets = new Map<string, Set<string>>();
        for (const row of itemRows.rows) {
            let items: Array<{ Description?: string }> = [];
            try {
                const parsed = typeof row.items_json === 'string' ? JSON.parse(row.items_json) : row.items_json;
                if (Array.isArray(parsed)) items = parsed;
            } catch { /* skip malformed */ }
            for (const it of items) {
                const t = normalizeTreatment(it.Description);
                if (!t) continue;
                if (!treatmentMap.has(row.client_id)) {
                    treatmentMap.set(row.client_id, { name: t, date: row.sale_date }); // newest-first → most recent
                }
                if (!histSets.has(row.client_id)) histSets.set(row.client_id, new Set());
                histSets.get(row.client_id)!.add(t);
            }
        }
        for (const [cid, set] of histSets) historyMap.set(cid, [...set]);
    }

    // Get client details (name, phone, email) from cache
    const clientDetailResult = await sql`
        SELECT DISTINCT ON (client_id)
            client_id, first_name, last_name, email, phone
        FROM mb_clients_cache
        WHERE client_id = ANY(string_to_array(${clientIdsCsv}, ','))
    `;

    const clientMap = new Map<string, { firstName: string; lastName: string; email: string; phone: string }>();
    for (const row of clientDetailResult.rows) {
        clientMap.set(row.client_id, {
            firstName: row.first_name || '',
            lastName: row.last_name || '',
            email: row.email || '',
            phone: row.phone || '',
        });
    }

    // Build lapsed patient list
    const lapsed: LapsedPatientDB[] = [];
    for (const row of salesResult.rows) {
        const clientId = row.client_id;
        const details = clientMap.get(clientId);
        if (!details?.phone) continue; // Must have a phone to be contactable

        const treatment = treatmentMap.get(clientId);
        const history = historyMap.get(clientId) || [];

        // Apply treatment filter if specified — match anyone who has EVER had the
        // treatment (canonical name), not just their most recent one.
        if (treatmentFilter) {
            const wanted = treatmentFilter.toLowerCase();
            if (!history.some(t => t.toLowerCase() === wanted)) continue;
        }

        const daysSince = Number(row.days_since);
        let segment: LapsedPatientDB['segment'];
        if (daysSince < 90) segment = 'recent-lapse';
        else if (daysSince < 180) segment = 'lapsed';
        else segment = 'long-lapsed';

        lapsed.push({
            mbClientId: clientId,
            firstName: details.firstName,
            lastName: details.lastName,
            email: details.email,
            phone: details.phone,
            totalRevenue: Number(row.total_revenue),
            lastSaleDate: row.last_sale_date,
            daysSinceLastVisit: daysSince,
            segment,
            lastTreatmentType: treatment?.name,
            lastTreatmentDate: treatment?.date,
            treatmentHistory: historyMap.get(clientId),
        });
    }

    return lapsed;
}

/**
 * Get all unique treatment types from appointment history.
 * Used for the treatment filter dropdown in the UI.
 */
export async function getAvailableTreatments(): Promise<string[]> {
    try {
        // Treatments come from sales line items, normalized to canonical clinical names.
        const result = await sql`
            SELECT DISTINCT item->>'Description' AS descr
            FROM mb_sales_history s, jsonb_array_elements(
                -- normalize legacy double-encoded ('string') rows back to a JSON array
                CASE jsonb_typeof(s.items_json)
                    WHEN 'array' THEN s.items_json
                    WHEN 'string' THEN (s.items_json #>> '{}')::jsonb
                    ELSE '[]'::jsonb
                END
            ) item
            WHERE item->>'Description' IS NOT NULL
        `;
        const set = new Set<string>();
        for (const r of result.rows) {
            const t = normalizeTreatment(r.descr);
            if (t) set.add(t);
        }
        return [...set].sort();
    } catch {
        return [];
    }
}

/**
 * Get sync statistics for admin panel display.
 */
export async function getSyncStats(): Promise<{
    salesCount: number;
    appointmentsCount: number;
    clientsCount: number;
    syncStates: SyncState[];
}> {
    try {
        const [salesCount, apptsCount, clientsCount, states] = await Promise.all([
            sql`SELECT COUNT(*) as cnt FROM mb_sales_history`.then(r => Number(r.rows[0]?.cnt || 0)),
            sql`SELECT COUNT(*) as cnt FROM mb_appointments_history`.then(r => Number(r.rows[0]?.cnt || 0)),
            sql`SELECT COUNT(*) as cnt FROM mb_clients_cache`.then(r => Number(r.rows[0]?.cnt || 0)).catch(() => 0),
            getSyncState(),
        ]);
        return {
            salesCount,
            appointmentsCount: apptsCount,
            clientsCount,
            syncStates: states,
        };
    } catch {
        return { salesCount: 0, appointmentsCount: 0, clientsCount: 0, syncStates: [] };
    }
}

// ---------------------------------------------------------------------------
// Internal: Upsert helpers
// ---------------------------------------------------------------------------

async function upsertSales(sales: Sale[]): Promise<number> {
    let inserted = 0;
    for (const sale of sales) {
        const totalAmount = sale.PurchasedItems?.reduce((s, item) => s + (item.TotalAmount || 0), 0) || 0;
        const paymentsTotal = sale.Payments?.reduce((s, p) => s + (p.Amount || 0), 0) || 0;
        const saleDate = (sale.SaleDate || sale.SaleDateTime || '').split('T')[0];
        if (!saleDate || !sale.ClientId) continue;

        await sql`
            INSERT INTO mb_sales_history (sale_id, client_id, sale_date, location_id, total_amount, items_json, payments_total, synced_at)
            VALUES (${sale.Id}, ${sale.ClientId}, ${saleDate}, ${sale.LocationId || 0}, ${totalAmount},
                    ${sql.json(sale.PurchasedItems || [])}, ${paymentsTotal}, NOW())
            ON CONFLICT (sale_id) DO UPDATE SET
                total_amount = ${totalAmount},
                items_json = ${sql.json(sale.PurchasedItems || [])},
                payments_total = ${paymentsTotal},
                synced_at = NOW()
        `;
        inserted++;
    }
    return inserted;
}

async function upsertAppointments(appts: StaffAppointment[]): Promise<number> {
    let inserted = 0;
    for (const appt of appts) {
        if (!appt.ClientId) continue;
        const staffName = appt.Staff?.DisplayName || appt.Staff?.FirstName || '';

        await sql`
            INSERT INTO mb_appointments_history
                (appointment_id, client_id, start_date, status, session_type_id, session_type_name, location_id, staff_name, synced_at)
            VALUES (${appt.Id}, ${appt.ClientId}, ${appt.StartDateTime}, ${appt.Status},
                    ${appt.SessionTypeId || 0}, ${appt.SessionType?.Name || null},
                    ${appt.LocationId || 0}, ${staffName}, NOW())
            ON CONFLICT (appointment_id) DO UPDATE SET
                status = ${appt.Status},
                session_type_name = COALESCE(${appt.SessionType?.Name || null}, mb_appointments_history.session_type_name),
                synced_at = NOW()
        `;
        inserted++;
    }
    return inserted;
}

async function upsertClients(clients: Client[]): Promise<void> {
    for (const client of clients) {
        const phone = normalizePhone(client.MobilePhone || client.HomePhone || '');
        // Use empty string instead of null when API returns no referral — distinguishes
        // "checked, no referral" from "never checked" (NULL) for rebackfill logic
        const referredBy = client.ReferredBy || '';
        const creationDate = client.CreationDate || null;
        await sql`
            INSERT INTO mb_clients_cache (client_id, first_name, last_name, email, phone, referred_by, creation_date, synced_at)
            VALUES (${client.Id}, ${client.FirstName || ''}, ${client.LastName || ''}, ${client.Email || ''}, ${phone}, ${referredBy}, ${creationDate}, NOW())
            ON CONFLICT (client_id) DO UPDATE SET
                first_name = ${client.FirstName || ''},
                last_name = ${client.LastName || ''},
                email = ${client.Email || ''},
                phone = ${phone},
                referred_by = ${referredBy},
                creation_date = ${creationDate},
                synced_at = NOW()
        `;
    }
}
