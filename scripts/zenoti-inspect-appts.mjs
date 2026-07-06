/**
 * READ-ONLY: characterize MindBody appointment rows on/after the 7/1 cutover.
 * These would overlap Zenoti's 7/1→ appointment backfill (double-count risk).
 * Run: node --env-file=.env.local scripts/zenoti-inspect-appts.mjs
 */
import postgres from 'postgres';
const url = process.env.SBNEW_POSTGRES_URL || process.env.POSTGRES_URL;
const sql = postgres(url, { ssl: 'require', max: 2 });

try {
  // Bucket by calendar date (ET) and status, on/after 2026-07-01
  const rows = await sql`
    SELECT (start_date AT TIME ZONE 'America/New_York')::date AS d, status, COUNT(*)::int AS n
    FROM mb_appointments_history
    WHERE (start_date AT TIME ZONE 'America/New_York')::date >= '2026-07-01'
    GROUP BY 1, 2 ORDER BY 1, 2`;
  console.log('MB appts (ET date) >= 2026-07-01, by date/status:');
  let total = 0;
  for (const r of rows) { console.log(`  ${r.d.toISOString().slice(0,10)}  ${String(r.status).padEnd(10)} ${r.n}`); total += r.n; }
  console.log(`  TOTAL >= 7/1: ${total}`);

  // How many of those clients also appear in the 6/30-and-earlier MB history?
  const distinct = await sql`
    SELECT COUNT(DISTINCT client_id)::int AS n
    FROM mb_appointments_history
    WHERE (start_date AT TIME ZONE 'America/New_York')::date >= '2026-07-01'`;
  console.log(`  distinct clients in >= 7/1 MB appts: ${distinct[0].n}`);

  // 6/30 exactly (should be KEPT — authoritative <= 6/30)
  const jun30 = await sql`
    SELECT COUNT(*)::int AS n FROM mb_appointments_history
    WHERE (start_date AT TIME ZONE 'America/New_York')::date = '2026-06-30'`;
  console.log(`\n  (for reference) MB appts on 6/30 ET: ${jun30[0].n}  ← stay, authoritative`);

  console.log('\n✅ read-only');
} catch (e) { console.error('❌', e.message); }
finally { await sql.end(); }
