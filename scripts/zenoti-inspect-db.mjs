/**
 * READ-ONLY DB inspection for the Zenoti cutover (marketing dashboard).
 * Confirms the exact MindBody straggler rows dated > 2026-06-30 before we purge,
 * and shows current table shape (source column? sale_id type? row counts).
 *
 * Run: node --env-file=.env.local scripts/zenoti-inspect-db.mjs
 */
import postgres from 'postgres';

const url = process.env.SBNEW_POSTGRES_URL || process.env.POSTGRES_URL;
if (!url) { console.error('No SBNEW_POSTGRES_URL / POSTGRES_URL in env'); process.exit(1); }
const sql = postgres(url, { ssl: 'require', max: 2 });

const CUTOVER = '2026-06-30';

try {
  // Schema state: does `source` exist? what type is sale_id / appointment_id?
  const cols = await sql`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_name IN ('mb_sales_history','mb_appointments_history','mb_clients_cache')
      AND column_name IN ('sale_id','appointment_id','source')
    ORDER BY table_name, column_name`;
  console.log('SCHEMA STATE:');
  for (const c of cols) console.log(`  ${c.table_name}.${c.column_name} = ${c.data_type}`);

  // Sales rows dated AFTER cutover (candidate stragglers)
  const stragglers = await sql`
    SELECT sale_id, client_id, sale_date, total_amount, items_json
    FROM mb_sales_history
    WHERE sale_date > ${CUTOVER}
    ORDER BY sale_date, sale_id`;
  console.log(`\nSALES rows dated > ${CUTOVER}: ${stragglers.length}`);
  for (const r of stragglers) {
    const desc = Array.isArray(r.items_json) ? r.items_json.map(i => i.Description).join(' | ')
               : (typeof r.items_json === 'string' ? r.items_json.slice(0, 60) : '');
    console.log(`  sale_id=${r.sale_id} date=${String(r.sale_date).slice(0,10)} $${r.total_amount} client=${r.client_id} :: ${desc}`);
  }
  const zeroDollar = stragglers.filter(r => Number(r.total_amount) === 0);
  console.log(`  → of which $0: ${zeroDollar.length}`);

  // Appointments dated after cutover too (are there MB appt stragglers?)
  const apptStrag = await sql`
    SELECT COUNT(*)::int AS n, MIN(start_date) AS first, MAX(start_date) AS last
    FROM mb_appointments_history
    WHERE start_date > ${CUTOVER}`;
  console.log(`\nAPPT rows dated > ${CUTOVER}: ${apptStrag[0].n} (range ${apptStrag[0].first ?? '-'} .. ${apptStrag[0].last ?? '-'})`);

  // Row counts / any zenoti already present?
  const counts = await sql`
    SELECT 'sales' AS t, COUNT(*)::int AS n FROM mb_sales_history
    UNION ALL SELECT 'appts', COUNT(*)::int FROM mb_appointments_history
    UNION ALL SELECT 'clients', COUNT(*)::int FROM mb_clients_cache`;
  console.log('\nROW COUNTS:');
  for (const c of counts) console.log(`  ${c.t}: ${c.n}`);

  console.log('\n✅ read-only — nothing written');
} catch (e) {
  console.error('❌', e.message);
} finally {
  await sql.end();
}
