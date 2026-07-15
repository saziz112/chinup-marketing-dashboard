/**
 * MindBody DB Queries — Postgres-backed replacements for live API calls.
 *
 * These functions query mb_sales_history, mb_clients_cache, and
 * mb_appointments_history directly, eliminating ~50 API calls per request.
 *
 * Data freshness: daily incremental sync via cron/sync-research (~10 API calls/day).
 * Tables populated by Phase 27 backfill + mindbody-sync.ts incrementalSync().
 */

import { sql } from '@/lib/db/sql';
import { normalizePhone } from './mindbody';

// ---------------------------------------------------------------------------
// Types — match the shapes that route handlers expect
// ---------------------------------------------------------------------------

export interface ClientDB {
    Id: string;
    FirstName: string;
    LastName: string;
    Email: string;
    phone: string;
    ReferredBy: string | null;
    CreationDate: string | null;
}

export interface SaleDB {
    Id: number;
    ClientId: string;
    saleDate: string;
    LocationId: number;
    totalAmount: number;
    paymentsTotal: number;
    PurchasedItems: Array<{ TotalAmount?: number; Description?: string; IsService?: boolean }>;
}

type ClientRevenue = { client: ClientDB; revenue: number };

// ---------------------------------------------------------------------------
// B1: getRevenueFromDB — replaces getSales() in metrics/revenue
// ---------------------------------------------------------------------------

export async function getRevenueFromDB(
    startDate: string,
    endDate: string,
): Promise<{ totalRevenue: number; saleCount: number }> {
    const start = startDate.split('T')[0];
    const end = endDate.split('T')[0];

    // Use payments_total when available, fall back to total_amount for historical rows
    // (difference is only gift card purchases — negligible for most sales)
    const result = await sql`
        SELECT COALESCE(SUM(CASE WHEN payments_total > 0 THEN payments_total ELSE total_amount END), 0) as total,
               COUNT(*) as count
        FROM mb_sales_history
        WHERE sale_date BETWEEN ${start} AND ${end}
    `;

    return {
        totalRevenue: Number(result.rows[0]?.total || 0),
        saleCount: Number(result.rows[0]?.count || 0),
    };
}

// ---------------------------------------------------------------------------
// B2: getNewClientsCountFromDB — replaces getNewClients() in metrics/leads
// ---------------------------------------------------------------------------

export async function getNewClientsCountFromDB(
    startDate: string,
    endDate: string,
): Promise<number> {
    const start = startDate.split('T')[0];
    const end = endDate.split('T')[0];

    // A client only counts as NEW if no other client record sharing their
    // phone/email existed before the window. Post-Zenoti-cutover a returning
    // MindBody patient gets a second (Zenoti GUID) row whose creation_date is
    // their first Zenoti activity — without the peer check they'd be counted
    // as a brand-new lead.
    const result = await sql`
        WITH candidates AS (
            SELECT DISTINCT c.client_id,
                   NULLIF(RIGHT(regexp_replace(COALESCE(c.phone,''),'\D','','g'),10),'') AS phone,
                   NULLIF(LOWER(TRIM(c.email)),'') AS email
            FROM mb_clients_cache c
            JOIN mb_sales_history s ON s.client_id = c.client_id
            WHERE c.creation_date >= ${startDate}
              AND c.creation_date <= ${endDate}
              AND s.sale_date BETWEEN ${start} AND ${end}
        ),
        pre_existing AS (
            SELECT DISTINCT cand.client_id
            FROM candidates cand
            JOIN mb_clients_cache prior
              ON prior.client_id <> cand.client_id
             AND ((cand.phone IS NOT NULL AND NULLIF(RIGHT(regexp_replace(COALESCE(prior.phone,''),'\D','','g'),10),'') = cand.phone)
               OR (cand.email IS NOT NULL AND NULLIF(LOWER(TRIM(prior.email)),'') = cand.email))
            WHERE prior.creation_date < ${startDate}
        )
        SELECT COUNT(*) as count
        FROM candidates
        WHERE client_id NOT IN (SELECT client_id FROM pre_existing)
    `;

    return Number(result.rows[0]?.count || 0);
}

// ---------------------------------------------------------------------------
// B3: getClientEmailMapFromDB — replaces getClientEmailMap() in paid-ads/roas
// ---------------------------------------------------------------------------

export async function getClientEmailMapFromDB(
    startDate: string,
    endDate: string,
): Promise<Map<string, ClientRevenue>> {
    const start = startDate.split('T')[0];
    const end = endDate.split('T')[0];

    // Aggregate revenue across each email's single-hop identity group (all
    // client rows sharing the email, or sharing a phone with a row that has
    // it — sufficient for the MindBody→Zenoti GUID split; not a transitive
    // closure across chained phone/email changes).
    // Post-Zenoti-cutover the same patient exists as a MindBody row and a
    // Zenoti row; a per-client_id GROUP BY would let one of them (with $0
    // window revenue) shadow the other's purchases. The representative row
    // per email is the earliest-created client (usually the original
    // MindBody record). DISTINCT in peers prevents double-counting a peer
    // matched on both phone and email.
    const result = await sql`
        WITH clients AS (
            SELECT client_id, email, first_name, last_name, phone,
                   referred_by, creation_date,
                   NULLIF(LOWER(TRIM(email)),'') AS norm_email,
                   NULLIF(RIGHT(regexp_replace(COALESCE(phone,''),'\D','','g'),10),'') AS norm_phone
            FROM mb_clients_cache
        ),
        emailed AS (
            SELECT * FROM clients WHERE norm_email IS NOT NULL
        ),
        peers AS (
            SELECT DISTINCT e.norm_email, c.client_id AS peer_id
            FROM emailed e
            JOIN clients c
              ON c.norm_email = e.norm_email
              OR (e.norm_phone IS NOT NULL AND c.norm_phone = e.norm_phone)
        ),
        rev AS (
            SELECT p.norm_email, COALESCE(SUM(s.total_amount), 0) AS revenue
            FROM peers p
            LEFT JOIN mb_sales_history s
                ON s.client_id = p.peer_id
               AND s.sale_date BETWEEN ${start} AND ${end}
            GROUP BY p.norm_email
        )
        SELECT DISTINCT ON (e.norm_email)
               e.norm_email, e.client_id, e.email, e.first_name, e.last_name,
               e.phone, e.referred_by, e.creation_date, r.revenue
        FROM emailed e
        JOIN rev r ON r.norm_email = e.norm_email
        ORDER BY e.norm_email, e.creation_date ASC NULLS LAST
    `;

    const emailMap = new Map<string, ClientRevenue>();
    for (const row of result.rows) {
        const email = row.norm_email as string;
        if (!email) continue;
        emailMap.set(email, {
            client: {
                Id: row.client_id,
                FirstName: row.first_name || '',
                LastName: row.last_name || '',
                Email: row.email || '',
                phone: row.phone || '',
                ReferredBy: row.referred_by || null,
                CreationDate: row.creation_date || null,
            },
            revenue: Number(row.revenue),
        });
    }

    return emailMap;
}

// ---------------------------------------------------------------------------
// B3b: getAppointmentsByClientIds — appointment attribution for Paid Ads
// ---------------------------------------------------------------------------

export async function getAppointmentsByClientIds(
    clientIds: string[],
    startDate: string,
    endDate: string,
): Promise<Map<string, { booked: number; completed: number; noShow: number }>> {
    if (clientIds.length === 0) return new Map();

    const start = startDate.split('T')[0];
    const end = endDate.split('T')[0];

    // Count appointments across the requested client's full identity group, not just the
    // one client_id passed in. Post-Zenoti-cutover a lead's MindBody identity (numeric id)
    // and Zenoti identity (GUID id) are separate rows; appointments booked under the other
    // id would be missed by a client_id-only match. `peers` expands each requested id to
    // every client_id sharing its phone/email, then attributes counts back to the
    // requested id. DISTINCT prevents double-counting a peer matched on both phone+email.
    // Process in chunks to keep the ANY() arrays and joins bounded.
    const allRows: Array<{ client_id: string; status: string; cnt: number }> = [];
    const chunkSize = 50;
    for (let i = 0; i < clientIds.length; i += chunkSize) {
        const chunk = clientIds.slice(i, i + chunkSize);
        const result = await sql`
            WITH requested AS (
                SELECT client_id AS req_id,
                       NULLIF(RIGHT(regexp_replace(COALESCE(phone,''),'\D','','g'),10),'') AS phone,
                       NULLIF(LOWER(TRIM(email)),'') AS email
                FROM mb_clients_cache WHERE client_id = ANY(${chunk})
            ),
            peers AS (
                SELECT DISTINCT r.req_id, c.client_id AS peer_id
                FROM requested r
                JOIN mb_clients_cache c
                  ON (r.phone IS NOT NULL AND NULLIF(RIGHT(regexp_replace(COALESCE(c.phone,''),'\D','','g'),10),'') = r.phone)
                  OR (r.email IS NOT NULL AND NULLIF(LOWER(TRIM(c.email)),'') = r.email)
            )
            SELECT p.req_id AS client_id, a.status, COUNT(*)::int AS cnt
            FROM peers p
            JOIN mb_appointments_history a ON a.client_id = p.peer_id
            WHERE a.start_date::date BETWEEN ${start} AND ${end}
            GROUP BY p.req_id, a.status
        `;
        allRows.push(...result.rows as any[]);
    }

    const map = new Map<string, { booked: number; completed: number; noShow: number }>();

    for (const row of allRows) {
        const clientId = row.client_id as string;
        const entry = map.get(clientId) || { booked: 0, completed: 0, noShow: 0 };
        const cnt = Number(row.cnt);
        const status = (row.status as string || '').toLowerCase();

        if (status === 'completed' || status === 'arrived') {
            entry.completed += cnt;
        } else if (status === 'noshow' || status === 'no show') {
            entry.noShow += cnt;
        }
        // All statuses count as "booked" (they had an appointment created)
        entry.booked += cnt;

        map.set(clientId, entry);
    }

    return map;
}

// ---------------------------------------------------------------------------
// B4: getPurchasingClientsFromDB — replaces getPurchasingClients() in
//     attribution/leads and attribution/revenue
// ---------------------------------------------------------------------------

export async function getPurchasingClientsFromDB(
    startDate: string,
    endDate: string,
): Promise<{ clients: ClientDB[]; sales: SaleDB[] }> {
    const start = startDate.split('T')[0];
    const end = endDate.split('T')[0];

    const [clientsResult, salesResult] = await Promise.all([
        sql`
            SELECT c.client_id, c.first_name, c.last_name, c.email, c.phone,
                   c.referred_by, c.creation_date
            FROM mb_clients_cache c
            WHERE c.client_id IN (
                SELECT DISTINCT client_id FROM mb_sales_history
                WHERE sale_date BETWEEN ${start} AND ${end}
            )
        `,
        sql`
            SELECT sale_id, client_id, sale_date, location_id,
                   total_amount, items_json, payments_total
            FROM mb_sales_history
            WHERE sale_date BETWEEN ${start} AND ${end}
        `,
    ]);

    const clients: ClientDB[] = clientsResult.rows.map(row => ({
        Id: row.client_id,
        FirstName: row.first_name || '',
        LastName: row.last_name || '',
        Email: row.email || '',
        phone: row.phone || '',
        ReferredBy: row.referred_by || null,
        CreationDate: row.creation_date || null,
    }));

    const sales: SaleDB[] = salesResult.rows.map(row => {
        let items: SaleDB['PurchasedItems'] = [];
        try {
            const parsed = typeof row.items_json === 'string' ? JSON.parse(row.items_json) : row.items_json;
            if (Array.isArray(parsed)) items = parsed;
        } catch (e) {
            console.warn(`[mindbody-db] Failed to parse items_json for sale ${row.sale_id}:`, e);
        }

        return {
            Id: row.sale_id,
            ClientId: row.client_id,
            saleDate: row.sale_date,
            LocationId: row.location_id || 0,
            totalAmount: Number(row.total_amount),
            paymentsTotal: Number(row.payments_total || 0),
            PurchasedItems: items,
        };
    });

    return { clients, sales };
}

// ---------------------------------------------------------------------------
// B5: getClientMatchMapsFromDB — replaces getClientMatchMaps() in
//     attribution/ghl-revenue
// ---------------------------------------------------------------------------

export async function getClientMatchMapsFromDB(
    startDate: string,
    endDate: string,
): Promise<{
    emailMap: Map<string, ClientRevenue>;
    phoneMap: Map<string, ClientRevenue>;
    nameMap: Map<string, ClientRevenue>;
}> {
    const start = startDate.split('T')[0];
    const end = endDate.split('T')[0];

    const result = await sql`
        SELECT c.client_id, c.email, c.first_name, c.last_name, c.phone,
               c.referred_by, c.creation_date,
               COALESCE(SUM(s.total_amount), 0) as revenue
        FROM mb_clients_cache c
        JOIN mb_sales_history s ON s.client_id = c.client_id
        WHERE s.sale_date BETWEEN ${start} AND ${end}
        GROUP BY c.client_id, c.email, c.first_name, c.last_name, c.phone,
                 c.referred_by, c.creation_date
    `;

    const emailMap = new Map<string, ClientRevenue>();
    const phoneMap = new Map<string, ClientRevenue>();
    const nameMap = new Map<string, ClientRevenue>();
    const nameCollisions = new Set<string>();

    for (const row of result.rows) {
        const entry: ClientRevenue = {
            client: {
                Id: row.client_id,
                FirstName: row.first_name || '',
                LastName: row.last_name || '',
                Email: row.email || '',
                phone: row.phone || '',
                ReferredBy: row.referred_by || null,
                CreationDate: row.creation_date || null,
            },
            revenue: Number(row.revenue),
        };

        // Email map
        if (row.email) {
            const email = (row.email as string).toLowerCase().trim();
            if (email) emailMap.set(email, entry);
        }

        // Phone map — DB stores normalized phone already
        if (row.phone) {
            const phone = normalizePhone(row.phone);
            if (phone.length === 10 && !phoneMap.has(phone)) {
                phoneMap.set(phone, entry);
            }
        }

        // Name map (with collision detection)
        if (row.first_name && row.last_name) {
            const nameKey = `${(row.first_name as string).toLowerCase().trim()} ${(row.last_name as string).toLowerCase().trim()}`;
            if (nameMap.has(nameKey)) {
                nameCollisions.add(nameKey);
            } else {
                nameMap.set(nameKey, entry);
            }
        }
    }

    // Remove ambiguous names
    for (const name of nameCollisions) {
        nameMap.delete(name);
    }

    return { emailMap, phoneMap, nameMap };
}
