// READ-ONLY: is the blank-source GHL bucket call-ins, or sync artifacts?
// Discriminators: creation-time distribution (business hours vs bulk spikes),
// contactability (phone vs email), and whether they were already patients.
import { createPool } from '@vercel/postgres';
const p = createPool({ connectionString: process.env.SBNEW_POSTGRES_URL });

const BUCKET = `CASE
    WHEN source IS NULL OR TRIM(source)='' OR TRIM(source)='-' THEN '(blank)'
    WHEN source ILIKE '%facebook%' OR source ILIKE 'fb-%' OR source ILIKE '%instagram%' THEN 'paid-social'
    WHEN source ILIKE 'google ads%' OR source ILIKE 'google%' THEN 'paid-search'
    WHEN source ILIKE '%website%' OR source ILIKE '%chat widget%' OR source ILIKE '%consultation form%' OR source ILIKE '%waitlist%' THEN 'website'
    ELSE 'other' END`;

console.log('=== 1. Volume + contactability by bucket (contacts created last 90d) ===');
const a = await p.query(`
  SELECT ${BUCKET} bucket, count(*) n,
    round(100.0*count(*) FILTER (WHERE phone_normalized IS NOT NULL AND phone_normalized<>'')/count(*)) pct_phone,
    round(100.0*count(*) FILTER (WHERE email IS NOT NULL AND email<>'')/count(*)) pct_email,
    round(100.0*count(*) FILTER (WHERE jsonb_typeof(tags)='array' AND jsonb_array_length(tags)>0)/count(*)) pct_tagged
  FROM ghl_contacts_map WHERE created_at >= NOW()-INTERVAL '90 days'
  GROUP BY 1 ORDER BY n DESC`);
for (const r of a.rows) console.log(` ${r.bucket.padEnd(12)} n=${String(r.n).padStart(5)}  phone=${r.pct_phone}%  email=${r.pct_email}%  tagged=${r.pct_tagged}%`);

console.log('\n=== 2. Creation hour-of-day, blanks vs paid-social (business hours => human/call) ===');
const b = await p.query(`
  SELECT ${BUCKET} bucket, EXTRACT(hour FROM created_at AT TIME ZONE 'America/New_York')::int hr, count(*) n
  FROM ghl_contacts_map WHERE created_at >= NOW()-INTERVAL '90 days'
    AND (${BUCKET}) IN ('(blank)','paid-social') GROUP BY 1,2 ORDER BY 2`);
const byHour = {};
for (const r of b.rows) (byHour[r.hr] ??= {})[r.bucket] = Number(r.n);
for (let h = 0; h < 24; h++) {
    const blank = byHour[h]?.['(blank)'] || 0, ps = byHour[h]?.['paid-social'] || 0;
    if (blank || ps) console.log(` ${String(h).padStart(2)}:00  blank=${String(blank).padStart(4)} ${'█'.repeat(Math.round(blank / 8))}  | social=${String(ps).padStart(4)}`);
}

console.log('\n=== 3. Bulk-import detection: biggest single days for blanks ===');
const c = await p.query(`
  SELECT created_at::date d, count(*) n FROM ghl_contacts_map
  WHERE created_at >= NOW()-INTERVAL '90 days' AND (source IS NULL OR TRIM(source)='')
  GROUP BY 1 ORDER BY n DESC LIMIT 8`);
for (const r of c.rows) console.log(` ${String(r.d).slice(0,15)}  ${r.n}`);
const days = await p.query(`
  SELECT count(DISTINCT created_at::date) d FROM ghl_contacts_map
  WHERE created_at >= NOW()-INTERVAL '90 days' AND (source IS NULL OR TRIM(source)='')`);
console.log(` distinct days with blank creations: ${days.rows[0].d} of ~90`);

console.log('\n=== 4. Lead status by bucket (Emily: a lead = no purchase ever) ===');
const d = await p.query(`
  WITH g AS (
    SELECT ${BUCKET} bucket, phone_normalized ph, LOWER(TRIM(email)) em, created_at
    FROM ghl_contacts_map WHERE created_at >= NOW()-INTERVAL '90 days'
  ), ident AS (
    SELECT g.bucket, g.created_at, c.client_id
    FROM g LEFT JOIN mb_clients_cache c
      ON (g.ph IS NOT NULL AND g.ph <> '' AND RIGHT(regexp_replace(COALESCE(c.phone,''),'\\D','','g'),10) = RIGHT(g.ph,10))
      OR (g.em IS NOT NULL AND g.em <> '' AND LOWER(TRIM(c.email)) = g.em)
  )
  SELECT bucket,
    count(*) rows_,
    count(*) FILTER (WHERE client_id IS NOT NULL) matched_patient,
    count(*) FILTER (WHERE client_id IN (SELECT client_id FROM mb_sales_history)) ever_purchased,
    count(*) FILTER (WHERE client_id IN (SELECT client_id FROM mb_appointments_history)) ever_appt
  FROM ident GROUP BY 1 ORDER BY rows_ DESC`);
for (const r of d.rows) {
    const pct = (x) => r.rows_ ? Math.round(100 * x / r.rows_) + '%' : '-';
    console.log(` ${r.bucket.padEnd(12)} rows=${String(r.rows_).padStart(5)}  matched_to_patient=${pct(r.matched_patient).padStart(4)}  ever_purchased=${pct(r.ever_purchased).padStart(4)}  ever_appt=${pct(r.ever_appt).padStart(4)}`);
}
process.exit(0);
