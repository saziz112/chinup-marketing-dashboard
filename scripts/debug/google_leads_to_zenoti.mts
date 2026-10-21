/**
 * Google Ads leads -> Zenoti outcomes, for the Well Labs results write-up.
 * Lead = GHL contact whose native attributionSource carries a gclid.
 * Match = same email (lowercased) or same 10-digit phone in mb_clients_cache.
 * Revenue = mb_sales_history on or after the lead date. Read-only.
 *   npx tsx --env-file=.env.local scripts/debug/google_leads_to_zenoti.mts 2026-08-01
 */
const { sql } = await import('../../src/lib/db/sql');
const since = process.argv[2] ?? '2026-08-01';
const rows = (r: any) => r.rows ?? r;

const leads = rows(await sql`
  WITH g AS (
    SELECT contact_id, location_key, created_at::date AS lead_date,
           lower(nullif(email, '')) AS email, right(regexp_replace(phone_normalized, '\\D', '', 'g'), 10) AS phone,
           attribution_source->>'url' AS landing
      FROM ghl_contacts_map
     WHERE created_at >= ${since}::date
       AND coalesce(attribution_source->>'gclid', '') <> ''
  ), m AS (
    SELECT g.*, c.client_id, c.creation_date::date AS zenoti_created
      FROM g
      LEFT JOIN LATERAL (
        SELECT client_id, creation_date FROM mb_clients_cache c
         WHERE (g.email IS NOT NULL AND lower(c.email) = g.email)
            OR (length(g.phone) = 10 AND right(regexp_replace(c.phone, '\\D', '', 'g'), 10) = g.phone)
         ORDER BY creation_date LIMIT 1) c ON true
  )
  SELECT m.location_key, m.lead_date, m.landing, m.client_id, m.zenoti_created,
         coalesce(sum(s.total_amount), 0)::numeric(10,2) AS revenue,
         min(s.sale_date)::date AS first_sale
    FROM m LEFT JOIN mb_sales_history s
      ON s.client_id = m.client_id AND s.sale_date::date >= m.lead_date
   GROUP BY 1,2,3,4,5 ORDER BY 1,2`);

const by = new Map<string, { leads: number; zenoti: number; existing: number; paying: number; rev: number }>();
for (const l of leads) {
  const b = by.get(l.location_key) ?? { leads: 0, zenoti: 0, existing: 0, paying: 0, rev: 0 };
  b.leads++;
  if (l.client_id) b.zenoti++;
  if (l.client_id && l.zenoti_created && l.zenoti_created < l.lead_date) b.existing++;
  if (Number(l.revenue) > 0) { b.paying++; b.rev += Number(l.revenue); }
  by.set(l.location_key, b);
}
console.log(`GHL gclid leads created since ${since}: ${leads.length}`);
console.table(Object.fromEntries(by));
console.log('\nPaying leads (no names):');
for (const l of leads.filter((l: any) => Number(l.revenue) > 0))
  console.log(`  ${l.location_key.padEnd(9)} lead ${l.lead_date.toISOString?.().slice(0,10) ?? l.lead_date}  first sale ${l.first_sale?.toISOString?.().slice(0,10) ?? l.first_sale}  $${l.revenue}  ${l.landing ?? ''}`);
process.exit(0);
