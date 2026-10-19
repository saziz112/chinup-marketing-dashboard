/**
 * Stamps native GHL attributionSource onto ghl_contacts_map.
 *
 * The contacts sync runs on the v1 JWT API, which does not return
 * attributionSource. The v2 single-contact GET does, and there is no bulk
 * endpoint, so this is one request per contact. Runs daily in the
 * sync-research cron, right after the contacts sync. Replaces the manual
 * scripts/backfill_attribution.mjs, which last ran 2026-08-12.
 *
 * Resumable: only rows with attribution_synced_at IS NULL are picked up, and
 * a failed fetch leaves the row unstamped so the next run retries it.
 * Stores the RAW blob; channel resolution happens at read time in
 * src/lib/attribution.ts.
 */

import { sql } from '@/lib/db/sql';

const WINDOW_DAYS = 120;
const CONCURRENCY = 10; // GHL burst limit is 100 req / 10s
const PAUSE_MS = 1100;

const PIT_ENV: Record<string, string> = {
    decatur: 'GHL_PIT_DECATUR',
    kennesaw: 'GHL_PIT_KENNESAW',
    smyrna: 'GHL_PIT_SMYRNA',
};

export async function syncGhlAttribution(deadline: number): Promise<{
    fetched: number;
    withAttribution: number;
    failed: number;
    remaining: number;
}> {
    const { rows: pending } = await sql<{ contact_id: string; location_key: string }>`
        SELECT contact_id, location_key
          FROM ghl_contacts_map
         WHERE created_at >= now() - (${WINDOW_DAYS} || ' days')::interval
           AND attribution_synced_at IS NULL
         ORDER BY created_at DESC
    `;

    let fetched = 0;
    let withAttribution = 0;
    let failed = 0;

    for (let i = 0; i < pending.length && Date.now() < deadline; i += CONCURRENCY) {
        if (i > 0) await new Promise((r) => setTimeout(r, PAUSE_MS));

        await Promise.all(pending.slice(i, i + CONCURRENCY).map(async (row) => {
            const token = process.env[PIT_ENV[row.location_key]];
            if (!token) {
                failed++;
                return;
            }
            try {
                const res = await fetch(`https://services.leadconnectorhq.com/contacts/${row.contact_id}`, {
                    headers: { Authorization: `Bearer ${token}`, Version: '2021-07-28', Accept: 'application/json' },
                });
                if (!res.ok) {
                    failed++;
                    return;
                }
                const attr = (await res.json()).contact?.attributionSource ?? null;

                // Send JSON text with an explicit ::jsonb cast. The backfill script
                // once stored 4,228 rows as JSON *strings* via sql.json(), after
                // which ->>'sessionSource' read NULL everywhere.
                await sql`
                    UPDATE ghl_contacts_map
                       SET attribution_source = ${attr ? JSON.stringify(attr) : null}::jsonb,
                           attribution_synced_at = NOW()
                     WHERE contact_id = ${row.contact_id}
                       AND location_key = ${row.location_key}
                `;
                fetched++;
                if (attr) withAttribution++;
            } catch {
                failed++;
            }
        }));
    }

    return { fetched, withAttribution, failed, remaining: pending.length - fetched };
}
