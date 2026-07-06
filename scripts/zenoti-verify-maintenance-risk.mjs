/**
 * READ-ONLY: quantify maintenance-segment cross-source risk.
 * At-risk = a MindBody identity whose last MB sale looks stale, but a phone/email-
 * matched Zenoti identity was seen MORE RECENTLY. maintenance keys on client_id and
 * would flag the MB identity "due" while the person was actually just treated.
 * Run: node --env-file=.env.local scripts/zenoti-verify-maintenance-risk.mjs
 */
import postgres from 'postgres';
const url = process.env.SBNEW_POSTGRES_URL || process.env.POSTGRES_URL;
const sql = postgres(url, { ssl: 'require', max: 2 });
const ph = `NULLIF(RIGHT(regexp_replace(COALESCE(phone,''),'\\D','','g'),10),'')`;

try {
  // MindBody clients that share phone/email with a Zenoti-active client whose latest
  // Zenoti sale is AFTER the MindBody client's latest MB sale.
  const rows = await sql`
    WITH mb AS (
      SELECT c.client_id, c.first_name, c.last_name,
             NULLIF(RIGHT(regexp_replace(COALESCE(c.phone,''),'\D','','g'),10),'') AS phone,
             NULLIF(LOWER(TRIM(c.email)),'') AS email,
             (SELECT MAX(sale_date) FROM mb_sales_history s WHERE s.client_id=c.client_id) AS mb_last
      FROM mb_clients_cache c WHERE c.source='mindbody'
    ),
    zn AS (
      SELECT NULLIF(RIGHT(regexp_replace(COALESCE(c.phone,''),'\D','','g'),10),'') AS phone,
             NULLIF(LOWER(TRIM(c.email)),'') AS email,
             MAX(s.sale_date) AS zn_last
      FROM mb_clients_cache c
      JOIN mb_sales_history s ON s.client_id=c.client_id AND s.source='zenoti'
      WHERE c.source='zenoti'
      GROUP BY 1,2
    )
    SELECT mb.client_id, mb.first_name, mb.last_name,
           to_char(mb.mb_last,'YYYY-MM-DD') AS mb_last,
           to_char(GREATEST(zn.zn_last, zn2.zn_last),'YYYY-MM-DD') AS zn_last
    FROM mb
    LEFT JOIN zn  ON zn.phone  IS NOT NULL AND zn.phone  = mb.phone
    LEFT JOIN zn zn2 ON zn2.email IS NOT NULL AND zn2.email = mb.email
    WHERE (zn.zn_last IS NOT NULL OR zn2.zn_last IS NOT NULL)
      AND COALESCE(GREATEST(zn.zn_last, zn2.zn_last), zn.zn_last, zn2.zn_last) > mb.mb_last
    ORDER BY mb.mb_last`;
  console.log(`At-risk MB identities (stale in MB, more-recent Zenoti visit under matched identity): ${rows.length}\n`);
  for (const r of rows.slice(0, 40))
    console.log(`  ${(r.first_name+' '+r.last_name).padEnd(28)} MB-last=${r.mb_last}  Zenoti-last=${r.zn_last}`);
  if (rows.length > 40) console.log(`  … +${rows.length-40} more`);
  console.log('\nThese are the patients the maintenance segment could mis-flag "you\'re due" until it merges cross-source.');
  console.log('✅ read-only');
} catch (e) { console.error('❌', e.message); }
finally { await sql.end(); }
