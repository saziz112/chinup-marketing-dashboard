/**
 * Patient history queries over the Postgres history tables (MindBody history
 * through 2026-06-30 + Zenoti sync from 2026-07-01). MindBody's own sync and
 * backfill were removed with the MindBody cancellation (2026-10-01).
 */

import { sql } from '@/lib/db/sql';
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
