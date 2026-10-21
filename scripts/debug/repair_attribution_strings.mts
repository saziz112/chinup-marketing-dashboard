// One-off repair: unwrap ghl_contacts_map.attribution_source rows stored as jsonb strings
// (double-encoded by the 10/20 sync) back into objects. Dry run unless --apply.
import { config } from 'dotenv';
config({ path: '.env.local' });
const { sql } = await import('../../src/lib/db/sql');

const rows = (r: any) => r.rows ?? r;
const [before] = rows(await sql`
  SELECT COUNT(*)::int AS strings,
         COUNT(*) FILTER (WHERE (attribution_source #>> '{}')::jsonb->>'gclid' <> '')::int AS gclids
    FROM ghl_contacts_map WHERE jsonb_typeof(attribution_source) = 'string'`);
console.log('String rows:', before.strings, '| with gclid:', before.gclids);

if (process.argv.includes('--apply')) {
    const res: any = await sql`
      UPDATE ghl_contacts_map SET attribution_source = (attribution_source #>> '{}')::jsonb
       WHERE jsonb_typeof(attribution_source) = 'string'`;
    console.log('Repaired:', res.count ?? res.rowCount);
    const [after] = rows(await sql`SELECT COUNT(*)::int AS n FROM ghl_contacts_map WHERE jsonb_typeof(attribution_source) = 'string'`);
    console.log('String rows remaining:', after.n);
} else {
    console.log('Dry run. Re-run with --apply to repair.');
}
process.exit(0);
