/**
 * P3 verification (READ-ONLY) — run after the Full Cutover.
 * Confirms the 7/1 seam, no double-count, and that Zenoti activity is present.
 * Run: node --env-file=.env.local scripts/zenoti-verify-p3.mjs
 */
import postgres from 'postgres';
const url = process.env.SBNEW_POSTGRES_URL || process.env.POSTGRES_URL;
const sql = postgres(url, { ssl: 'require', max: 2 });

const ok = (b) => (b ? '✅' : '❌');

try {
  // 1. Source split
  const split = await sql`
    SELECT 'sales' AS t, source, COUNT(*)::int AS n FROM mb_sales_history GROUP BY source
    UNION ALL SELECT 'appts', source, COUNT(*)::int FROM mb_appointments_history GROUP BY source
    UNION ALL SELECT 'clients', source, COUNT(*)::int FROM mb_clients_cache GROUP BY source
    ORDER BY 1, 2`;
  console.log('SOURCE SPLIT:');
  for (const r of split) console.log(`  ${r.t.padEnd(8)} ${String(r.source).padEnd(9)} ${r.n}`);

  // 2. Seam: no MindBody rows after 6/30, no Zenoti rows before 7/1
  const mbAfter = await sql`
    SELECT COUNT(*)::int AS n FROM mb_sales_history WHERE source='mindbody' AND sale_date > '2026-06-30'`;
  const mbApptAfter = await sql`
    SELECT COUNT(*)::int AS n FROM mb_appointments_history
    WHERE source='mindbody' AND (start_date AT TIME ZONE 'America/New_York')::date >= '2026-07-01'`;
  const znBefore = await sql`
    SELECT COUNT(*)::int AS n FROM mb_sales_history WHERE source='zenoti' AND sale_date < '2026-07-01'`;
  console.log('\nSEAM INTEGRITY:');
  console.log(`  ${ok(mbAfter[0].n === 0)} MindBody sales after 6/30: ${mbAfter[0].n} (want 0)`);
  console.log(`  ${ok(mbApptAfter[0].n === 0)} MindBody appts >= 7/1: ${mbApptAfter[0].n} (want 0)`);
  console.log(`  ${ok(znBefore[0].n === 0)} Zenoti sales before 7/1: ${znBefore[0].n} (want 0)`);

  // 3. Zenoti presence + date range
  const zn = await sql`
    SELECT MIN(sale_date) AS lo, MAX(sale_date) AS hi, COUNT(*)::int AS n,
           COUNT(DISTINCT client_id)::int AS guests, SUM(total_amount)::numeric AS rev
    FROM mb_sales_history WHERE source='zenoti'`;
  const znAppt = await sql`
    SELECT COUNT(*)::int AS n FROM mb_appointments_history WHERE source='zenoti'`;
  console.log('\nZENOTI DATA:');
  console.log(`  sales lines: ${zn[0].n}  ($${Number(zn[0].rev || 0).toFixed(2)}), guests: ${zn[0].guests}, range ${String(zn[0].lo).slice(0,10)}..${String(zn[0].hi).slice(0,10)}`);
  console.log(`  appointments: ${znAppt[0].n}`);

  // 4. Sales-only guests still missing contact rows (should be 0 after guest backfill)
  const missing = await sql`
    SELECT COUNT(DISTINCT s.client_id)::int AS n
    FROM mb_sales_history s
    WHERE s.source='zenoti' AND s.client_id NOT IN (SELECT client_id FROM mb_clients_cache)`;
  console.log(`  ${ok(missing[0].n === 0)} Zenoti sales guests missing from cache: ${missing[0].n} (want 0)`);

  // 5. Treatment classification on Zenoti sales (what feeds lapsed/maintenance)
  const items = await sql`
    SELECT jsonb_array_elements(items_json)->>'Description' AS d, COUNT(*)::int AS n
    FROM mb_sales_history WHERE source='zenoti' GROUP BY 1 ORDER BY 2 DESC LIMIT 25`;
  console.log('\nTOP ZENOTI ITEM DESCRIPTIONS (feed normalizeTreatment):');
  for (const r of items) console.log(`  ${String(r.n).padStart(3)}  ${r.d}`);

  console.log('\n✅ read-only — nothing written');
} catch (e) { console.error('❌', e.message); }
finally { await sql.end(); }
