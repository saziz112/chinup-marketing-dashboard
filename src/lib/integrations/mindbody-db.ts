/**
 * MindBody DB Queries — Postgres-backed replacements for live API calls.
 *
 * These functions query mb_sales_history, mb_clients_cache, and
 * mb_appointments_history directly, eliminating ~50 API calls per request.
 *
 * Data freshness: daily incremental sync via cron/sync-research (~10 API calls/day).
 * Tables populated by Phase 27 backfill + mindbody-sync.ts incrementalSync().
 */

import { sql } from '@vercel/postgres';
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

    const result = await sql`
        SELECT COUNT(DISTINCT c.client_id) as count
        FROM mb_clients_cache c
        JOIN mb_sales_history s ON s.client_id = c.client_id
        WHERE c.creation_date >= ${startDate}
          AND c.creation_date <= ${endDate}
          AND s.sale_date BETWEEN ${start} AND ${end}
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

    const result = await sql`
        SELECT c.client_id, c.email, c.first_name, c.last_name, c.phone,
               c.referred_by, c.creation_date,
               COALESCE(SUM(s.total_amount), 0) as revenue
        FROM mb_clients_cache c
        JOIN mb_sales_history s ON s.client_id = c.client_id
        WHERE s.sale_date BETWEEN ${start} AND ${end}
          AND c.email IS NOT NULL AND c.email != ''
        GROUP BY c.client_id, c.email, c.first_name, c.last_name, c.phone,
                 c.referred_by, c.creation_date
    `;

    const emailMap = new Map<string, ClientRevenue>();
    for (const row of result.rows) {
        const email = (row.email as string).toLowerCase().trim();
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
