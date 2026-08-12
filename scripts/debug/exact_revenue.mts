/** Exact per-channel revenue + existing-patient counts for the briefing. */
import { getLeadSourceReport } from '@/lib/lead-sources';

async function main() {
  const r = await getLeadSourceReport({ minAgeDays: 30, maxAgeDays: 180, maturationDays: 30, location: null });
  console.log('TOTALS', JSON.stringify(r.totals), 'unbackfilled', r.unbackfilled);
  console.log('\nchannel'.padEnd(16), 'leads'.padStart(6), 'new'.padStart(6), 'exist'.padStart(6),
    'showed'.padStart(7), 'revenue'.padStart(12), 'rev/lead'.padStart(9));
  for (const x of r.rows) {
    console.log(
      x.channel.padEnd(16),
      String(x.leads).padStart(6),
      String(x.newLeads).padStart(6),
      String(x.existingPatients).padStart(6),
      String(x.showed).padStart(7),
      x.revenue.toFixed(2).padStart(12),
      (x.revPerLead === null ? '—' : '$' + Math.round(x.revPerLead)).padStart(9),
    );
  }
  process.exit(0);
}
main();
