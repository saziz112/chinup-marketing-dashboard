/**
 * Backfills native GHL attributionSource onto ghl_contacts_map.
 *
 * Why this exists: the contacts sync runs on the v1 JWT API, which does not
 * return attributionSource at all. The v2 single-contact GET does. There is no
 * bulk endpoint, so this is one request per contact.
 *
 * Stores the RAW attribution blob only. Channel resolution happens at read
 * time via src/lib/attribution.ts, so changing the normalizer never requires
 * re-running this.
 *
 * Resumable: skips contacts already stamped with attribution_synced_at.
 *
 * Run:  node --env-file=.env.local scripts/backfill_attribution.mjs [days]
 */

import postgres from 'postgres';

const DAYS = Number(process.argv[2] || 120);
const CONCURRENCY = 10; // GHL burst limit is 100 req / 10s
const PAUSE_MS = 1100;

const sql = postgres(process.env.SBNEW_POSTGRES_URL || process.env.POSTGRES_URL, {
  ssl: 'require',
});

const PIT = {
  decatur: process.env.GHL_PIT_DECATUR,
  kennesaw: process.env.GHL_PIT_KENNESAW,
  smyrna: process.env.GHL_PIT_SMYRNA,
};

// Self-migration, matching the pattern used by the sync jobs.
await sql`ALTER TABLE ghl_contacts_map ADD COLUMN IF NOT EXISTS attribution_source JSONB`;
await sql`ALTER TABLE ghl_contacts_map ADD COLUMN IF NOT EXISTS attribution_synced_at TIMESTAMPTZ`;
await sql`CREATE INDEX IF NOT EXISTS idx_ghl_contacts_attr_synced
          ON ghl_contacts_map(attribution_synced_at)`;

const pending = await sql`
  SELECT contact_id, location_key
    FROM ghl_contacts_map
   WHERE created_at >= now() - (${DAYS} || ' days')::interval
     AND attribution_synced_at IS NULL
   ORDER BY created_at DESC
`;

console.log(`${pending.length} contacts to fetch (last ${DAYS} days).`);
if (!pending.length) {
  await sql.end();
  process.exit(0);
}

let done = 0;
let withAttr = 0;
let failed = 0;
const started = Date.now();

for (let i = 0; i < pending.length; i += CONCURRENCY) {
  const batch = pending.slice(i, i + CONCURRENCY);

  await Promise.all(
    batch.map(async (row) => {
      const token = PIT[row.location_key];
      if (!token) {
        failed++;
        return;
      }
      try {
        const res = await fetch(
          `https://services.leadconnectorhq.com/contacts/${row.contact_id}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Version: '2021-07-28',
              Accept: 'application/json',
            },
          },
        );
        if (!res.ok) {
          failed++;
          return;
        }
        const attr = (await res.json()).contact?.attributionSource ?? null;
        if (attr) withAttr++;

        // Pass the OBJECT directly. Do not wrap in sql.json() and do not
        // JSON.stringify() -- either double-encodes, storing a JSON string
        // scalar instead of an object, after which ->>'sessionSource' returns
        // NULL for every row. Verified 2026-08-12: sql.json() here produced
        // jsonb_typeof = 'string' on 4,228 rows.
        // Repair if it ever recurs:
        //   UPDATE ghl_contacts_map SET attribution_source = (attribution_source #>> '{}')::jsonb
        //    WHERE jsonb_typeof(attribution_source) = 'string';
        await sql`
          UPDATE ghl_contacts_map
             SET attribution_source = ${attr},
                 attribution_synced_at = NOW()
           WHERE contact_id = ${row.contact_id}
             AND location_key = ${row.location_key}
        `;
      } catch {
        failed++;
      } finally {
        done++;
      }
    }),
  );

  if (i % 500 < CONCURRENCY) {
    const pct = ((done / pending.length) * 100).toFixed(1);
    const mins = ((Date.now() - started) / 60000).toFixed(1);
    console.log(`  ${done}/${pending.length} (${pct}%)  attributed=${withAttr}  failed=${failed}  ${mins}m`);
  }

  await new Promise((r) => setTimeout(r, PAUSE_MS));
}

console.log(`\nDone. fetched=${done} withAttribution=${withAttr} failed=${failed}`);

// Guard against the double-encoding regression described above.
const [bad] = await sql`
  SELECT count(*)::int AS n FROM ghl_contacts_map
   WHERE attribution_source IS NOT NULL AND jsonb_typeof(attribution_source) = 'string'`;
if (bad.n > 0) {
  console.error(`\nWARNING: ${bad.n} rows stored as JSON strings, not objects.`);
  console.error("Repair: UPDATE ghl_contacts_map SET attribution_source = (attribution_source #>> '{}')::jsonb");
  console.error("         WHERE jsonb_typeof(attribution_source) = 'string';");
}

await sql.end();
