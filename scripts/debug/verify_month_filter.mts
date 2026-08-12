/** Verify the new month filter, purchase metric and maturity flag. Read-only. */
import { getLeadSourceReport } from '@/lib/lead-sources';

async function main() {
  for (const m of ['2026-05', '2026-06', '2026-07', '2026-08'] as const) {
    const [y, mm] = m.split('-').map(Number);
    const from = `${y}-${String(mm).padStart(2, '0')}-01`;
    const to = mm === 12 ? `${y + 1}-01-01` : `${y}-${String(mm + 1).padStart(2, '0')}-01`;
    const r = await getLeadSourceReport({ from, to, maturationDays: 30, location: null });
    const t = r.totals;
    console.log(
      `${m}  leads=${String(t.newLeads).padStart(4)}  bought=${String(t.purchased).padStart(3)}  ` +
      `rate=${(t.purchased / t.newLeads * 100).toFixed(0).padStart(2)}%  ` +
      `rev30=$${Math.round(t.revenue).toLocaleString().padStart(8)}  ` +
      `toDate=$${Math.round(t.revenueToDate).toLocaleString().padStart(8)}  ` +
      `matured=${r.window.matured}${r.window.maturesOn ? ' (on ' + r.window.maturesOn + ')' : ''}`);
  }

  // Determinism: a fixed month must return identical totals on repeat calls,
  // unlike the rolling window.
  const a = await getLeadSourceReport({ from: '2026-05-01', to: '2026-06-01', maturationDays: 30 });
  const b = await getLeadSourceReport({ from: '2026-05-01', to: '2026-06-01', maturationDays: 30 });
  console.log(`\nfixed-month repeatability: ${JSON.stringify(a.totals) === JSON.stringify(b.totals) ? 'IDENTICAL' : 'DIFFERS'}`);
  console.log(`  ${JSON.stringify(a.totals)}`);

  // Rolling window still works and is still relative.
  const roll = await getLeadSourceReport({ minAgeDays: 30, maxAgeDays: 180, maturationDays: 30 });
  console.log(`\nrolling 30-180 still works: leads=${roll.totals.newLeads} bought=${roll.totals.purchased} matured=${roll.window.matured}`);
  console.log(`  window: ${roll.window.cohortStart} -> ${roll.window.cohortEnd}`);
  process.exit(0);
}
main();
