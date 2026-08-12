/** Is a sync actively writing right now? Read-only. */
import { sql } from '@/lib/db/sql';

async function main() {
  const st = await sql<{ sync_type: string; last_synced_at: Date | null; details: unknown }>`
    SELECT * FROM mb_sync_state ORDER BY 1`;
  console.log('mb_sync_state:');
  for (const r of st.rows) console.log('  ', JSON.stringify(r).slice(0, 220));

  const cols = await sql<{ table_name: string; column_name: string }>`
    SELECT table_name, column_name FROM information_schema.columns
     WHERE table_name IN ('mb_sales_history','mb_appointments_history')
       AND column_name IN ('created_at','synced_at','updated_at','inserted_at')
     ORDER BY 1,2`;
  console.log('\ntimestamp columns available:');
  for (const c of cols.rows) console.log(`   ${c.table_name}.${c.column_name}`);

  const s = await sql<{ n: number; maxd: string | null }>`
    SELECT COUNT(*)::int AS n, MAX(sale_date)::text AS maxd FROM mb_sales_history`;
  const a = await sql<{ n: number; maxd: string | null }>`
    SELECT COUNT(*)::int AS n, MAX(start_date)::text AS maxd FROM mb_appointments_history`;
  console.log(`\nmb_sales_history        rows=${s.rows[0].n}  latest sale_date=${s.rows[0].maxd}`);
  console.log(`mb_appointments_history rows=${a.rows[0].n}  latest start_date=${a.rows[0].maxd}`);
  process.exit(0);
}
main().catch((e) => { console.error(String(e).slice(0, 500)); process.exit(1); });
