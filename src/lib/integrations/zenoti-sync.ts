/**
 * Zenoti → Postgres sync (marketing dashboard).
 *
 * Companion to `mindbody-sync.ts`. Writes Zenoti activity into the SAME unified
 * tables (`mb_sales_history` / `mb_appointments_history` / `mb_clients_cache`)
 * with `source='zenoti'`, so every existing read — `getLapsedPatientsFromDB`,
 * the maintenance engine, revenue reads — picks up Zenoti data with no query
 * changes. Emits the identical row shapes MindBody does (notably the
 * `items_json` `{Description, IsService, TotalAmount}` array that drives
 * `normalizeTreatment`).
 *
 * Cutover seam (locked 2026-07-06): MindBody is authoritative ≤ 2026-06-30,
 * Zenoti owns 2026-07-01 →. Backfill therefore starts at the cutover date; the
 * two systems never overlap (June 29–30 were dual-entered and stay MindBody's).
 *
 * ⚠️ SCHEMA MIGRATION REQUIRED FIRST. `sale_id` / `appointment_id` ship as
 * `INTEGER PRIMARY KEY`; Zenoti keys are GUIDs. `migrateSchemaForZenoti()`
 * widens them to TEXT and adds the `source` column. It is idempotent (checks
 * information_schema, no-ops once migrated) but the first run rewrites those
 * tables — run it deliberately, not on a hot path.
 */

import { sql } from '@/lib/db/sql';
import { normalizePhone } from './mindbody';
import {
    fetchZenotiSalesRows,
    getZenotiAppointments,
    getZenotiGuest,
    zenotiStatusToMbStatus,
    centerIdToLocationId,
    type ZenotiSalesRow,
    type ZenotiAppointment,
} from './zenoti';

/** MindBody ≤ this date; Zenoti owns everything after. */
export const ZENOTI_CUTOVER_DATE = '2026-07-01';

// ---------------------------------------------------------------------------
// One-time schema migration (idempotent, guarded)
// ---------------------------------------------------------------------------

/**
 * Widen the integer PK columns to TEXT (so GUIDs fit) and add the `source`
 * column tagging existing rows 'mindbody'. Safe to call repeatedly — it inspects
 * information_schema and only alters what still needs it. The first call rewrites
 * mb_sales_history + mb_appointments_history (fast at current ~19K-row scale, but
 * it takes a brief ACCESS EXCLUSIVE lock — do it in a maintenance step, not per sync).
 */
export async function migrateSchemaForZenoti(): Promise<{ changed: string[] }> {
    const changed: string[] = [];

    const colType = async (table: string, column: string): Promise<string | null> => {
        const { rows } = await sql`
            SELECT data_type FROM information_schema.columns
            WHERE table_name = ${table} AND column_name = ${column}
        `;
        return rows[0]?.data_type ?? null;
    };

    // sale_id INTEGER → TEXT
    if ((await colType('mb_sales_history', 'sale_id')) === 'integer') {
        await sql`ALTER TABLE mb_sales_history ALTER COLUMN sale_id TYPE TEXT USING sale_id::text`;
        changed.push('mb_sales_history.sale_id → text');
    }
    // appointment_id INTEGER → TEXT
    if ((await colType('mb_appointments_history', 'appointment_id')) === 'integer') {
        await sql`ALTER TABLE mb_appointments_history ALTER COLUMN appointment_id TYPE TEXT USING appointment_id::text`;
        changed.push('mb_appointments_history.appointment_id → text');
    }

    // source column on all three (DEFAULT 'mindbody' tags every existing row).
    // Table names are fixed literals here — safe to interpolate into sql.query().
    for (const table of ['mb_sales_history', 'mb_appointments_history', 'mb_clients_cache']) {
        if (!(await colType(table, 'source'))) {
            await sql.query(`ALTER TABLE ${table} ADD COLUMN source TEXT NOT NULL DEFAULT 'mindbody'`);
            changed.push(`${table}.source added`);
        }
    }

    return { changed };
}

// ---------------------------------------------------------------------------
// Upsert helpers
// ---------------------------------------------------------------------------

/**
 * One mb_sales_history row per Zenoti Closed line item (sale_id = invoice_item_id,
 * a GUID). We KEEP $0-collected lines — unlike the bonus dashboard, which drops
 * them: a $0 package-redemption line still names a real treatment ("VI Chemical
 * Peel", "Dysport - Per Unit") the patient received that day, which is exactly
 * what lapsed/maintenance detection reads. `status='Closed'` dedupes the
 * Open+Closed refund double-count.
 */
async function upsertZenotiSales(rows: ZenotiSalesRow[]): Promise<number> {
    let inserted = 0;
    for (const row of rows) {
        if (row.status !== 'Closed') continue;
        if (!row.guest_id) continue;
        const saleId = row.invoice_item_id;
        const saleDate = (row.sale_date || row.invoice_date || '').slice(0, 10);
        if (!saleId || !saleDate) continue;

        const totalAmount = row.collected || 0;
        const items = [{
            Description: row.item_name || '',
            IsService: row.item_type === 'Service',
            TotalAmount: row.collected || 0,
        }];

        await sql`
            INSERT INTO mb_sales_history
                (sale_id, client_id, sale_date, location_id, total_amount, items_json, payments_total, source, synced_at)
            VALUES (${saleId}, ${row.guest_id}, ${saleDate}, ${centerIdToLocationId(row.center_id)},
                    ${totalAmount}, ${sql.json(items)}, ${totalAmount}, 'zenoti', NOW())
            ON CONFLICT (sale_id) DO UPDATE SET
                total_amount = ${totalAmount},
                items_json = ${sql.json(items)},
                payments_total = ${totalAmount},
                source = 'zenoti',
                synced_at = NOW()
        `;
        inserted++;
    }
    return inserted;
}

/**
 * One mb_appointments_history row per Zenoti appointment. Blockouts (status 10,
 * no service) are skipped. Zenoti — unlike MindBody — captures cancellations and
 * no-shows, and carries the real service name (MindBody's session_type_name was
 * always NULL), so we store it. session_type_id stays 0 (Zenoti uses a GUID).
 */
async function upsertZenotiAppointments(appts: ZenotiAppointment[]): Promise<number> {
    let inserted = 0;
    for (const appt of appts) {
        const status = zenotiStatusToMbStatus(appt.status);
        if (!status) continue;                     // blockout / unknown → skip
        const clientId = appt.guest?.id;
        if (!clientId || !appt.start_time) continue;

        const staffName = appt.therapist
            ? `${appt.therapist.first_name || ''} ${appt.therapist.last_name || ''}`.trim()
            : '';

        await sql`
            INSERT INTO mb_appointments_history
                (appointment_id, client_id, start_date, status, session_type_id, session_type_name, location_id, staff_name, source, synced_at)
            VALUES (${appt.appointment_id}, ${clientId}, ${appt.start_time}, ${status},
                    ${0}, ${appt.service?.name || null},
                    ${centerIdToLocationId(appt.center_id)}, ${staffName}, 'zenoti', NOW())
            ON CONFLICT (appointment_id) DO UPDATE SET
                status = ${status},
                session_type_name = COALESCE(${appt.service?.name || null}, mb_appointments_history.session_type_name),
                source = 'zenoti',
                synced_at = NOW()
        `;
        inserted++;
    }
    return inserted;
}

interface GuestContact {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
}

async function upsertGuestContacts(guests: GuestContact[]): Promise<number> {
    let n = 0;
    for (const g of guests) {
        if (!g.id) continue;
        await sql`
            INSERT INTO mb_clients_cache
                (client_id, first_name, last_name, email, phone, referred_by, creation_date, source, synced_at)
            VALUES (${g.id}, ${g.firstName}, ${g.lastName}, ${g.email}, ${g.phone}, '', NULL, 'zenoti', NOW())
            ON CONFLICT (client_id) DO UPDATE SET
                first_name = ${g.firstName},
                last_name = ${g.lastName},
                email = ${g.email},
                phone = ${g.phone},
                source = 'zenoti',
                synced_at = NOW()
        `;
        n++;
    }
    return n;
}

/** Harvest contact rows embedded in appointment payloads — free (no extra API calls). */
function guestsFromAppointments(appts: ZenotiAppointment[]): GuestContact[] {
    const byId = new Map<string, GuestContact>();
    for (const a of appts) {
        const g = a.guest;
        if (!g?.id) continue;
        const rawPhone = g.mobile?.display_number || g.mobile?.number || '';
        byId.set(g.id, {
            id: g.id,
            firstName: g.first_name || '',
            lastName: g.last_name || '',
            email: g.email || '',
            phone: normalizePhone(rawPhone),
        });
    }
    return [...byId.values()];
}

// ---------------------------------------------------------------------------
// Backfill
// ---------------------------------------------------------------------------

/**
 * Backfill Zenoti sales from the cutover date → today, in one pass, and upsert
 * the guest contacts that appear only in sales is handled separately
 * (`backfillZenotiGuests`). `fetchZenotiSalesRows` paginates internally.
 */
export async function backfillZenotiSales(
    startDate: string = ZENOTI_CUTOVER_DATE,
): Promise<{ total: number; done: boolean; label: string }> {
    const endDate = new Date().toISOString().slice(0, 10);
    const rows = await fetchZenotiSalesRows(startDate, endDate);
    const inserted = await upsertZenotiSales(rows);

    await sql`
        INSERT INTO mb_sync_state (sync_type, last_sync_date, total_records, updated_at)
        VALUES ('zenoti_sales', ${endDate}, (SELECT COUNT(*) FROM mb_sales_history WHERE source = 'zenoti'), NOW())
        ON CONFLICT (sync_type) DO UPDATE SET
            last_sync_date = ${endDate},
            total_records = (SELECT COUNT(*) FROM mb_sales_history WHERE source = 'zenoti'),
            updated_at = NOW()
    `;
    return { total: inserted, done: true, label: `Zenoti sales ${startDate}→${endDate}: ${inserted} lines` };
}

/**
 * Backfill Zenoti appointments from cutover → today. `getZenotiAppointments`
 * enforces the 7-day-window cap internally and tags each record's center.
 * Also harvests the embedded guest contacts into mb_clients_cache for free.
 */
export async function backfillZenotiAppointments(
    startDate: string = ZENOTI_CUTOVER_DATE,
): Promise<{ total: number; guests: number; done: boolean; label: string }> {
    const endDate = new Date().toISOString().slice(0, 10);
    const appts = await getZenotiAppointments(startDate, endDate);
    const inserted = await upsertZenotiAppointments(appts);
    const guests = await upsertGuestContacts(guestsFromAppointments(appts));

    await sql`
        INSERT INTO mb_sync_state (sync_type, last_sync_date, total_records, updated_at)
        VALUES ('zenoti_appointments', ${endDate}, (SELECT COUNT(*) FROM mb_appointments_history WHERE source = 'zenoti'), NOW())
        ON CONFLICT (sync_type) DO UPDATE SET
            last_sync_date = ${endDate},
            total_records = (SELECT COUNT(*) FROM mb_appointments_history WHERE source = 'zenoti'),
            updated_at = NOW()
    `;
    return {
        total: inserted,
        guests,
        done: true,
        label: `Zenoti appts ${startDate}→${endDate}: ${inserted} appts, ${guests} guests harvested`,
    };
}

/**
 * Fill in contact details for Zenoti guests that appear in sales but have NO
 * appointment (walk-in retail, etc.) and so weren't harvested — one
 * `getZenotiGuest` call each. Resumable: processes up to CHUNK guests per call,
 * throttled to stay well under the 60/min org-wide rate limit. Returns
 * `done:false` while more remain; caller should loop.
 */
export async function backfillZenotiGuests(): Promise<{ total: number; done: boolean; label: string }> {
    const CHUNK = 40;
    const THROTTLE_MS = 1100; // ~54 calls/min < 60/min org cap

    const { rows } = await sql`
        SELECT DISTINCT s.client_id
        FROM mb_sales_history s
        WHERE s.source = 'zenoti'
          AND s.client_id NOT IN (SELECT client_id FROM mb_clients_cache)
        ORDER BY s.client_id
        LIMIT ${CHUNK}
    `;
    const guestIds = rows.map(r => String(r.client_id));

    if (guestIds.length === 0) {
        await sql`
            INSERT INTO mb_sync_state (sync_type, last_sync_date, total_records, updated_at)
            VALUES ('zenoti_guests', ${new Date().toISOString().slice(0, 10)},
                    (SELECT COUNT(*) FROM mb_clients_cache WHERE source = 'zenoti'), NOW())
            ON CONFLICT (sync_type) DO UPDATE SET
                last_sync_date = ${new Date().toISOString().slice(0, 10)},
                total_records = (SELECT COUNT(*) FROM mb_clients_cache WHERE source = 'zenoti'),
                updated_at = NOW()
        `;
        return { total: 0, done: true, label: 'Zenoti guest backfill complete' };
    }

    const contacts: GuestContact[] = [];
    for (const id of guestIds) {
        const g = await getZenotiGuest(id);
        if (g) {
            contacts.push({
                id: g.id,
                firstName: g.firstName,
                lastName: g.lastName,
                email: g.email || '',
                phone: normalizePhone(g.phone || ''),
            });
        }
        await new Promise(r => setTimeout(r, THROTTLE_MS));
    }
    const saved = await upsertGuestContacts(contacts);
    return { total: saved, done: false, label: `Zenoti guests: +${saved} (${guestIds.length} processed)` };
}

// ---------------------------------------------------------------------------
// Incremental sync (daily cron)
// ---------------------------------------------------------------------------

/**
 * Fetch Zenoti activity since the last sync (2-day overlap for late arrivals),
 * upsert sales + appointments, harvest embedded guests, then top up any
 * still-missing sales-only guests (capped, throttled). Safe to run daily.
 */
export async function incrementalZenotiSync(): Promise<{
    newSales: number;
    newAppts: number;
    newGuests: number;
}> {
    const states = await sql`SELECT sync_type, last_sync_date FROM mb_sync_state WHERE sync_type IN ('zenoti_sales', 'zenoti_appointments')`;
    const salesState = states.rows.find(r => r.sync_type === 'zenoti_sales');
    const apptsState = states.rows.find(r => r.sync_type === 'zenoti_appointments');

    if (!salesState && !apptsState) {
        console.log('[zenoti-sync] No sync state — run backfill first');
        return { newSales: 0, newAppts: 0, newGuests: 0 };
    }

    const endDate = new Date().toISOString().slice(0, 10);
    const overlapFrom = (lastSyncDate: string): string => {
        const d = new Date(lastSyncDate);
        d.setDate(d.getDate() - 2);
        // Never reach back before the cutover (protects the clean seam).
        const s = d.toISOString().slice(0, 10);
        return s < ZENOTI_CUTOVER_DATE ? ZENOTI_CUTOVER_DATE : s;
    };

    let newSales = 0;
    let newAppts = 0;
    let newGuests = 0;

    if (salesState) {
        const rows = await fetchZenotiSalesRows(overlapFrom(salesState.last_sync_date), endDate);
        newSales = await upsertZenotiSales(rows);
        await sql`
            UPDATE mb_sync_state
            SET last_sync_date = ${endDate},
                total_records = (SELECT COUNT(*) FROM mb_sales_history WHERE source = 'zenoti'),
                updated_at = NOW()
            WHERE sync_type = 'zenoti_sales'
        `;
    }

    if (apptsState) {
        const appts = await getZenotiAppointments(overlapFrom(apptsState.last_sync_date), endDate);
        newAppts = await upsertZenotiAppointments(appts);
        newGuests = await upsertGuestContacts(guestsFromAppointments(appts));
        await sql`
            UPDATE mb_sync_state
            SET last_sync_date = ${endDate},
                total_records = (SELECT COUNT(*) FROM mb_appointments_history WHERE source = 'zenoti'),
                updated_at = NOW()
            WHERE sync_type = 'zenoti_appointments'
        `;
    }

    // Top up sales-only guests missing from cache (bounded so the cron stays under 60s).
    const missing = await sql`
        SELECT DISTINCT s.client_id
        FROM mb_sales_history s
        WHERE s.source = 'zenoti'
          AND s.client_id NOT IN (SELECT client_id FROM mb_clients_cache)
        LIMIT 20
    `;
    for (const r of missing.rows) {
        const g = await getZenotiGuest(String(r.client_id));
        if (g) {
            newGuests += await upsertGuestContacts([{
                id: g.id,
                firstName: g.firstName,
                lastName: g.lastName,
                email: g.email || '',
                phone: normalizePhone(g.phone || ''),
            }]);
        }
        await new Promise(res => setTimeout(res, 1100));
    }

    console.log(`[zenoti-sync] Incremental: ${newSales} sales, ${newAppts} appts, ${newGuests} guests`);
    return { newSales, newAppts, newGuests };
}
