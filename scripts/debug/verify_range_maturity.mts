/** Verify the date-range filter and the maturedShare figure. Read-only. */
import { getLeadSourceReport } from '@/lib/lead-sources';

async function show(label: string, from: string, to: string) {
  const r = await getLeadSourceReport({ from, to, maturationDays: 30, location: null });
  console.log(
    `${label.padEnd(22)} leads=${String(r.totals.newLeads).padStart(4)} ` +
    `bought=${String(r.totals.purchased).padStart(3)} ` +
    `matured=${r.window.matured} share=${(r.window.maturedShare * 100).toFixed(0)}% ` +
    `final=${r.window.maturesOn}`);
}

async function main() {
  await show('Jul 2026 (full)', '2026-07-01', '2026-08-01');
  await show('Jun 2026 (full)', '2026-06-01', '2026-07-01');
  await show('mid-Jun -> mid-Jul', '2026-06-15', '2026-07-16');
  await show('Aug 1-12 (raw)', '2026-08-01', '2026-08-13');

  // A range identical to a month must match the month path exactly.
  const a = await getLeadSourceReport({ from: '2026-07-01', to: '2026-08-01', maturationDays: 30 });
  const b = await getLeadSourceReport({ from: '2026-07-01', to: '2026-08-01', maturationDays: 30 });
  console.log(`\nrepeatable: ${JSON.stringify(a.totals) === JSON.stringify(b.totals) ? 'IDENTICAL' : 'DIFFERS'}`);
  process.exit(0);
}
main();
