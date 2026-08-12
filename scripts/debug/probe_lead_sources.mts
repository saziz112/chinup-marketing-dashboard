/**
 * Runtime probe: executes the REAL getLeadSourceReport through the app's own
 * DB shim, catching runtime-shape bugs a raw postgres.js script cannot.
 * Run: npx tsx --env-file=.env.local scripts/debug/probe_lead_sources.mts
 */
import { getLeadSourceReport } from '@/lib/lead-sources';
import { sql } from '@/lib/db/sql';

async function main() {
  const c0 = Date.now();
  await sql`SELECT 1`;
  console.log('cold_connect_ms', Date.now() - c0);

  // Optional: node ... probe_lead_sources.mts <minAge> <maxAge>
  const minAgeDays = Number(process.argv[2]) || 30;
  const maxAgeDays = Number(process.argv[3]) || 90;

  const t = Date.now();
  const r = await getLeadSourceReport({
    minAgeDays,
    maxAgeDays,
    maturationDays: 30,
    location: null,
  });
  console.log('elapsed_ms', Date.now() - t);
  console.log('unbackfilled', r.unbackfilled, 'totals', JSON.stringify(r.totals));
  console.table(
    r.rows.map((x) => ({
      channel: x.channel,
      leads: x.leads,
      newLeads: x.newLeads,
      showed: x.showed,
      showRate: x.showRate === null ? 'n/a' : (x.showRate * 100).toFixed(0) + '%',
      revPerLead: x.revPerLead === null ? 'n/a' : '$' + Math.round(x.revPerLead),
    })),
  );
  process.exit(0);
}

main();
