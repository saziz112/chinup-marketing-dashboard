/**
 * Analysis for the three requested lead-dashboard changes. Read-only.
 *   1. count PURCHASES instead of SHOWED
 *   2. filter by month
 *   3. attribute sale + conversion to the lead's submission date
 */
import { sql } from '@/lib/db/sql';
import { resolveChannel } from '@/lib/attribution';

function tagList(raw: unknown): string[] {
  let v = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return []; } }
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

async function main() {
  const r = await sql<{
    source: string | null; attribution_source: Record<string, unknown> | null; tags: unknown;
    created_at: Date; client_id: string | null; had_prior: boolean;
    showed_30: boolean; purchased_30: boolean; purchased_ever: boolean;
    days_to_purchase: number | null; rev_30: string; rev_ever: string;
  }>`
    WITH deduped AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(phone_normalized,''), NULLIF(email,''), contact_id))
             contact_id, phone_normalized, email, source, attribution_source, tags, created_at
        FROM ghl_contacts_map
       WHERE created_at >= now() - interval '400 days'
       ORDER BY COALESCE(NULLIF(phone_normalized,''), NULLIF(email,''), contact_id), created_at ASC
    ),
    matched AS (
      SELECT DISTINCT ON (d.contact_id) d.*, c.client_id
        FROM deduped d
        LEFT JOIN mb_clients_cache c
          ON ( d.phone_normalized IS NOT NULL AND d.phone_normalized <> ''
               AND right(regexp_replace(c.phone,'\\D','','g'),10) = right(d.phone_normalized,10) )
          OR ( d.email IS NOT NULL AND d.email <> '' AND lower(c.email) = lower(d.email) )
       ORDER BY d.contact_id,
                (d.phone_normalized IS NOT NULL
                 AND right(regexp_replace(c.phone,'\\D','','g'),10) = right(d.phone_normalized,10)) DESC,
                c.creation_date ASC NULLS LAST
    )
    SELECT m.source, m.attribution_source, m.tags, m.created_at, m.client_id,
      COALESCE((SELECT true FROM mb_sales_history s WHERE s.client_id=m.client_id
                 AND s.sale_date < m.created_at::date LIMIT 1),false) AS had_prior,
      COALESCE((SELECT true FROM mb_appointments_history a WHERE a.client_id=m.client_id
                 AND a.status IN ('Completed','Arrived') AND a.start_date >= m.created_at
                 AND a.start_date < m.created_at + interval '30 days' LIMIT 1),false) AS showed_30,
      COALESCE((SELECT true FROM mb_sales_history s WHERE s.client_id=m.client_id
                 AND s.sale_date >= m.created_at::date
                 AND s.sale_date < (m.created_at + interval '30 days')::date LIMIT 1),false) AS purchased_30,
      COALESCE((SELECT true FROM mb_sales_history s WHERE s.client_id=m.client_id
                 AND s.sale_date >= m.created_at::date LIMIT 1),false) AS purchased_ever,
      (SELECT MIN(s.sale_date::date - m.created_at::date) FROM mb_sales_history s
        WHERE s.client_id=m.client_id AND s.sale_date >= m.created_at::date) AS days_to_purchase,
      (SELECT COALESCE(SUM(s.total_amount),0) FROM mb_sales_history s WHERE s.client_id=m.client_id
         AND s.sale_date >= m.created_at::date
         AND s.sale_date < (m.created_at + interval '30 days')::date) AS rev_30,
      (SELECT COALESCE(SUM(s.total_amount),0) FROM mb_sales_history s WHERE s.client_id=m.client_id
         AND s.sale_date >= m.created_at::date) AS rev_ever
    FROM matched m`;

  const rows = r.rows.filter((x) => !x.had_prior);
  console.log(`deduped leads, no prior purchase, last 400d: ${rows.length}\n`);

  // --- 1. purchased vs showed, same 30-day window -------------------------
  let bothN = 0, showOnly = 0, buyOnly = 0, neither = 0;
  for (const x of rows) {
    if (x.showed_30 && x.purchased_30) bothN++;
    else if (x.showed_30) showOnly++;
    else if (x.purchased_30) buyOnly++;
    else neither++;
  }
  console.log('=== 1. PURCHASED vs SHOWED (both within 30 days of the lead) ===');
  console.log(`  showed AND purchased : ${bothN}`);
  console.log(`  showed, NO purchase  : ${showOnly}`);
  console.log(`  purchased, NO show   : ${buyOnly}   <- invisible under the current metric`);
  console.log(`  neither              : ${neither}`);

  // Per channel, so we can see if the swap changes the ranking.
  const ch = new Map<string, { n: number; showed: number; bought: number; rev: number }>();
  for (const x of rows) {
    const k = resolveChannel(x.source, x.attribution_source as never, tagList(x.tags));
    if (!ch.has(k)) ch.set(k, { n: 0, showed: 0, bought: 0, rev: 0 });
    const a = ch.get(k)!;
    a.n++; if (x.showed_30) a.showed++; if (x.purchased_30) a.bought++;
    a.rev += Number(x.rev_30 || 0);
  }
  console.log('\n  channel            leads  showed  bought   show%  buy%');
  for (const [k, v] of [...ch.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${k.padEnd(16)} ${String(v.n).padStart(6)}  ${String(v.showed).padStart(6)}  ` +
      `${String(v.bought).padStart(6)}  ${(v.showed / v.n * 100).toFixed(0).padStart(5)}% ` +
      `${(v.bought / v.n * 100).toFixed(0).padStart(4)}%`);
  }

  // --- 2/3. how long do leads take to buy? --------------------------------
  const buyers = rows.filter((x) => x.purchased_ever && x.days_to_purchase !== null);
  const d = buyers.map((x) => x.days_to_purchase!).sort((a, b) => a - b);
  const pct = (p: number) => d[Math.floor(d.length * p)] ?? 0;
  console.log(`\n=== 2/3. TIME FROM LEAD TO FIRST PURCHASE (n=${d.length}) ===`);
  console.log(`  median ${pct(0.5)}d   75th ${pct(0.75)}d   90th ${pct(0.9)}d   95th ${pct(0.95)}d`);
  for (const w of [7, 14, 30, 60, 90, 180]) {
    const within = d.filter((x) => x <= w).length;
    console.log(`  bought within ${String(w).padStart(3)}d: ${(within / d.length * 100).toFixed(0).padStart(3)}% of eventual buyers`);
  }

  const revEver = rows.reduce((s, x) => s + Number(x.rev_ever || 0), 0);
  const rev30 = rows.reduce((s, x) => s + Number(x.rev_30 || 0), 0);
  console.log(`\n  revenue captured by a 30-day window: $${Math.round(rev30).toLocaleString()} of ` +
    `$${Math.round(revEver).toLocaleString()} lifetime (${(rev30 / revEver * 100).toFixed(0)}%)`);

  // --- month maturity ------------------------------------------------------
  console.log('\n=== MONTH BUCKETS: how mature is each? ===');
  const byMonth = new Map<string, { n: number; bought30: number; boughtEver: number; rev30: number; revEver: number }>();
  for (const x of rows) {
    const k = x.created_at.toISOString().slice(0, 7);
    if (!byMonth.has(k)) byMonth.set(k, { n: 0, bought30: 0, boughtEver: 0, rev30: 0, revEver: 0 });
    const a = byMonth.get(k)!;
    a.n++; if (x.purchased_30) a.bought30++; if (x.purchased_ever) a.boughtEver++;
    a.rev30 += Number(x.rev_30 || 0); a.revEver += Number(x.rev_ever || 0);
  }
  console.log('  month     leads  buy30  buyEver   rev30       revEver     age');
  const today = rows.reduce((m, x) => x.created_at > m ? x.created_at : m, rows[0].created_at);
  for (const [k, v] of [...byMonth.entries()].sort()) {
    const age = Math.round((today.getTime() - new Date(k + '-15').getTime()) / 86400000);
    console.log(`  ${k}  ${String(v.n).padStart(5)}  ${String(v.bought30).padStart(5)}  ` +
      `${String(v.boughtEver).padStart(6)}  $${Math.round(v.rev30).toLocaleString().padStart(9)}  ` +
      `$${Math.round(v.revEver).toLocaleString().padStart(9)}  ${age}d`);
  }
  process.exit(0);
}
main();
