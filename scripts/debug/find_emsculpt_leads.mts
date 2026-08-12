/** Do the 110 "Emsculpt Form Submission" Google conversions exist in the CRM? Read-only. */
import { sql } from '@/lib/db/sql';

async function main() {
  const a = await sql<{ source: string | null; n: number }>`
    SELECT source, COUNT(*)::int AS n
      FROM ghl_contacts_map
     WHERE created_at >= '2026-02-13' AND created_at < '2026-07-14'
     GROUP BY source ORDER BY n DESC`;
  console.log('GHL source values in the Google-spend window:');
  for (const r of a.rows) console.log(`  ${String(r.n).padStart(5)}  ${r.source ?? '(null)'}`);

  const b = await sql<{ n: number }>`
    SELECT COUNT(*)::int AS n FROM ghl_contacts_map
     WHERE created_at >= '2026-02-13' AND created_at < '2026-07-14'
       AND (source ILIKE '%emsculpt%' OR contact_name ILIKE '%emsculpt%'
            OR (tags)::text ILIKE '%emsculpt%'
            OR (attribution_source)::text ILIKE '%emsculpt%')`;
  console.log(`\ncontacts mentioning "emsculpt" anywhere: ${b.rows[0].n}`);

  const c = await sql<{ k: string; n: number }>`
    SELECT COALESCE(attribution_source->>'utmCampaign','(none)') AS k, COUNT(*)::int AS n
      FROM ghl_contacts_map
     WHERE created_at >= '2026-02-13' AND created_at < '2026-07-14'
       AND (attribution_source->>'utmSource' ILIKE '%google%'
            OR attribution_source->>'medium' ILIKE '%cpc%'
            OR attribution_source->>'utmMedium' ILIKE '%cpc%')
     GROUP BY 1 ORDER BY n DESC LIMIT 20`;
  console.log('\nGoogle/cpc-attributed contacts by utm_campaign:');
  for (const r of c.rows) console.log(`  ${String(r.n).padStart(5)}  ${r.k}`);
  process.exit(0);
}
main();
