/**
 * Does adding the `tags` column change WHICH mb_clients_cache row a contact
 * matches? If so the report has a tie-break nondeterminism independent of the
 * Call-In change. Read-only.
 */
import { sql } from '@/lib/db/sql';
import postgres from 'postgres';

const pg = postgres(process.env.POSTGRES_URL || process.env.SBNEW_POSTGRES_URL!, { prepare: false });

const q = (withTags: boolean) => `
  WITH deduped AS (
    SELECT DISTINCT ON (COALESCE(NULLIF(phone_normalized,''), NULLIF(email,''), contact_id))
           contact_id, phone_normalized, email${withTags ? ', tags' : ''}, created_at
      FROM ghl_contacts_map
     WHERE created_at <  now() - interval '30 days'
       AND created_at >= now() - interval '180 days'
     ORDER BY COALESCE(NULLIF(phone_normalized,''), NULLIF(email,''), contact_id), created_at ASC
  )
  SELECT DISTINCT ON (d.contact_id) d.contact_id, c.client_id
    FROM deduped d
    LEFT JOIN mb_clients_cache c
      ON ( d.phone_normalized IS NOT NULL AND d.phone_normalized <> ''
           AND right(regexp_replace(c.phone,'\\\\D','','g'),10) = right(d.phone_normalized,10) )
      OR ( d.email IS NOT NULL AND d.email <> '' AND lower(c.email) = lower(d.email) )
   ORDER BY d.contact_id,
            (d.phone_normalized IS NOT NULL
             AND right(regexp_replace(c.phone,'\\\\D','','g'),10) = right(d.phone_normalized,10)) DESC,
            c.creation_date ASC NULLS LAST`;

async function main() {
  const a = await pg.unsafe(q(false));
  const b = await pg.unsafe(q(true));
  const ma = new Map((a as any[]).map((r) => [r.contact_id, r.client_id]));
  const mb = new Map((b as any[]).map((r) => [r.contact_id, r.client_id]));
  const diffs = [...ma.entries()].filter(([k, v]) => mb.get(k) !== v);
  console.log(`contacts: ${ma.size} vs ${mb.size}`);
  console.log(`contacts whose matched client_id CHANGED: ${diffs.length}`);
  for (const [k, v] of diffs.slice(0, 10)) console.log(`  ${k}: ${v} -> ${mb.get(k)}`);

  const dupes = await sql<{ n: number }>`
    SELECT COUNT(*)::int AS n FROM (
      SELECT right(regexp_replace(phone,'\\D','','g'),10) AS p
        FROM mb_clients_cache
       WHERE phone IS NOT NULL AND phone <> ''
       GROUP BY 1 HAVING COUNT(*) > 1) x`;
  console.log(`\nphone numbers shared by >1 mb_clients_cache row: ${dupes.rows[0].n}`);
  process.exit(0);
}
main();
