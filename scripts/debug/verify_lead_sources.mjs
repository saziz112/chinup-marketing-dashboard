/**
 * Re-baselines the lead-source report against live data and prints it next to
 * the spec's 2026-08-10 baseline (which grouped by GHL `source`).
 *
 * The SQL below is duplicated from src/lib/lead-sources.ts because that module
 * imports the '@/...' path alias, which plain node cannot resolve. Keep the two
 * in sync, or delete this script once the page is trusted.
 *
 * Run: node --env-file=.env.local scripts/debug/verify_lead_sources.mjs
 */

import postgres from 'postgres';
import { resolveChannel } from '../../src/lib/attribution.ts';

const MIN_AGE = 30, MAX_AGE = 90, MATURATION = 30;

const sql = postgres(process.env.SBNEW_POSTGRES_URL || process.env.POSTGRES_URL, { ssl: 'require' });

const raw = await sql`
  WITH deduped AS (
    SELECT DISTINCT ON (COALESCE(NULLIF(phone_normalized, ''), NULLIF(email, ''), contact_id))
           contact_id, phone_normalized, email, source, attribution_source,
           attribution_synced_at, created_at
      FROM ghl_contacts_map
     WHERE created_at <  now() - (${MIN_AGE} || ' days')::interval
       AND created_at >= now() - (${MAX_AGE} || ' days')::interval
     ORDER BY COALESCE(NULLIF(phone_normalized, ''), NULLIF(email, ''), contact_id), created_at ASC
  ),
  matched AS (
    SELECT DISTINCT ON (d.contact_id) d.*, c.client_id
      FROM deduped d
      LEFT JOIN mb_clients_cache c
        ON ( d.phone_normalized IS NOT NULL AND d.phone_normalized <> ''
             AND length(regexp_replace(c.phone, '\\D', '', 'g')) >= 10
             AND right(regexp_replace(c.phone, '\\D', '', 'g'), 10) = right(d.phone_normalized, 10) )
        OR ( d.email IS NOT NULL AND d.email <> '' AND lower(c.email) = lower(d.email) )
     ORDER BY d.contact_id,
              (d.phone_normalized IS NOT NULL
               AND length(regexp_replace(c.phone, '\\D', '', 'g')) >= 10
               AND right(regexp_replace(c.phone, '\\D', '', 'g'), 10) = right(d.phone_normalized, 10)) DESC,
              c.creation_date ASC NULLS LAST
  )
  SELECT m.contact_id, m.source, m.attribution_source, m.attribution_synced_at,
         COALESCE((SELECT true FROM mb_sales_history s
                    WHERE s.client_id = m.client_id AND s.sale_date < m.created_at::date LIMIT 1), false) AS had_prior_purchase,
         COALESCE((SELECT true FROM mb_appointments_history a
                    WHERE a.client_id = m.client_id AND a.status IN ('Completed','Arrived')
                      AND a.start_date >= m.created_at
                      AND a.start_date <  m.created_at + (${MATURATION} || ' days')::interval LIMIT 1), false) AS showed,
         (SELECT COALESCE(SUM(s.total_amount),0) FROM mb_sales_history s
           WHERE s.client_id = m.client_id AND s.sale_date >= m.created_at::date
             AND s.sale_date < (m.created_at + (${MATURATION} || ' days')::interval)::date) AS revenue
    FROM matched m
`;

const agg = new Map();
let unbackfilled = 0;
for (const r of raw) {
  if (!r.attribution_synced_at) unbackfilled++;
  const ch = resolveChannel(r.source, r.attribution_source);
  if (!agg.has(ch)) agg.set(ch, { channel: ch, leads: 0, newLeads: 0, existing: 0, showed: 0, revenue: 0 });
  const row = agg.get(ch);
  row.leads++;
  if (r.had_prior_purchase) { row.existing++; continue; }
  row.newLeads++;
  if (r.showed) row.showed++;
  row.revenue += Number(r.revenue || 0);
}

const rows = [...agg.values()].sort((a, b) => b.newLeads - a.newLeads);
console.log(`\ncontacts in cohort: ${raw.length}   awaiting backfill: ${unbackfilled}\n`);
console.log('channel          newLeads  showed  show%      revenue   rev/lead');
for (const r of rows) {
  const rate = r.newLeads >= 30 ? `${((r.showed / r.newLeads) * 100).toFixed(0)}%` : ' n<30';
  const rpl = r.newLeads >= 30 ? `$${Math.round(r.revenue / r.newLeads)}` : '   —';
  console.log(
    `${r.channel.padEnd(16)}${String(r.newLeads).padStart(8)}${String(r.showed).padStart(8)}` +
    `${rate.padStart(7)}${('$' + Math.round(r.revenue).toLocaleString()).padStart(13)}${rpl.padStart(11)}`,
  );
}

const t = rows.reduce((a, r) => ({
  newLeads: a.newLeads + r.newLeads, showed: a.showed + r.showed, revenue: a.revenue + r.revenue,
}), { newLeads: 0, showed: 0, revenue: 0 });
console.log(`\nTOTAL            ${String(t.newLeads).padStart(7)}${String(t.showed).padStart(8)}` +
  `${((t.showed / t.newLeads) * 100).toFixed(0).padStart(6)}%${('$' + Math.round(t.revenue).toLocaleString()).padStart(13)}`);

console.log(`
--- spec baseline 2026-08-10 (grouped by GHL \`source\`) ---
Paid social   483 leads   36 showed    7%   $23,853   $49/lead
(blank)       376 leads   52 showed   14%   $39,711   $106/lead
Website       181 leads   51 showed   28%   $49,773   $275/lead
Paid search    18 leads    3 showed   17%      $750   $42/lead`);

await sql.end();
