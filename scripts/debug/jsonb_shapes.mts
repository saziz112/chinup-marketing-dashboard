/** Storage shape of the two jsonb columns the lead-source report reads. Read-only. */
import { sql } from '@/lib/db/sql';

async function main() {
  const a = await sql<{ col: string; shape: string; n: number }>`
    SELECT 'attribution_source' AS col, COALESCE(jsonb_typeof(attribution_source),'(null)') AS shape,
           COUNT(*)::int AS n
      FROM ghl_contacts_map GROUP BY 2
    UNION ALL
    SELECT 'tags', COALESCE(jsonb_typeof(tags),'(null)'), COUNT(*)::int
      FROM ghl_contacts_map GROUP BY 2
    ORDER BY 1, 3 DESC`;
  for (const r of a.rows) console.log(`${r.col.padEnd(20)} ${r.shape.padEnd(8)} ${r.n}`);

  // Would any call-tagged contact be MISSED if we only read one shape?
  const b = await sql<{ shape: string; n: number }>`
    SELECT COALESCE(jsonb_typeof(tags),'(null)') AS shape, COUNT(*)::int AS n
      FROM ghl_contacts_map
     WHERE created_at <  now() - interval '30 days'
       AND created_at >= now() - interval '180 days'
       AND ( (tags)::text ILIKE '%name via lookup%'
          OR (tags)::text ILIKE '%find caller name%' )
     GROUP BY 1`;
  console.log('\ncall-tagged contacts by tags storage shape:');
  for (const r of b.rows) console.log(`  ${r.shape.padEnd(8)} ${r.n}`);
  process.exit(0);
}
main();
