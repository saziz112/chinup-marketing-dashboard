// READ-ONLY: did the malformed phone merge tag produce bad phone numbers on new leads?
import { createPool } from '@vercel/postgres';
const p = createPool({ connectionString: process.env.SBNEW_POSTGRES_URL });
const r = await p.query(`
  SELECT date_trunc('month', created_at)::date mo,
    count(*) n,
    count(*) FILTER (WHERE phone IS NULL OR TRIM(phone)='') no_phone,
    count(*) FILTER (WHERE phone ILIKE '%inbound%' OR phone ILIKE '%{{%') literal_tag,
    count(*) FILTER (WHERE phone_normalized IS NULL OR length(phone_normalized) < 10) unusable
  FROM ghl_contacts_map
  WHERE created_at >= NOW() - INTERVAL '6 months' AND source ILIKE '%fb-lead-form%'
  GROUP BY 1 ORDER BY 1`);
console.log('fb-lead-form contacts by month:');
console.log(' month        n    no_phone  literal_{{tag}}  unusable_phone');
for (const x of r.rows)
  console.log(` ${String(x.mo).slice(0,10)}  ${String(x.n).padStart(4)}   ${String(x.no_phone).padStart(5)}   ${String(x.literal_tag).padStart(9)}   ${String(x.unusable).padStart(10)}`);
const s = await p.query(`
  SELECT phone, count(*) n FROM ghl_contacts_map
  WHERE phone ILIKE '%{{%' OR phone ILIKE '%inbound%' GROUP BY 1 ORDER BY n DESC LIMIT 5`);
console.log('\nliteral-merge-tag phone values anywhere in DB:', s.rows.length ? '' : 'NONE');
for (const x of s.rows) console.log(` ${x.n} × ${JSON.stringify(x.phone).slice(0,70)}`);
process.exit(0);
