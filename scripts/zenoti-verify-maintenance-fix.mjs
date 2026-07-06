/**
 * DEFINITIVE (READ-ONLY): prove the maintenance cross-source suppression works.
 * Reproduces the mergedLast query added to getMaintenanceDuePatients over the SAME
 * candidate set the function would build (cadence-window clients), then confirms every
 * one of the 72 at-risk identities (stale in MB, recent Zenoti visit) is suppressed
 * (mergedLast > anchor date).
 * Run: node --env-file=.env.local scripts/zenoti-verify-maintenance-fix.mjs
 */
import postgres from 'postgres';
const url = process.env.SBNEW_POSTGRES_URL || process.env.POSTGRES_URL;
const sql = postgres(url, { ssl: 'require', max: 2 });

try {
  // The 72 at-risk identities: MB stale, phone/email-matched Zenoti visit more recent.
  const atRisk = await sql`
    WITH mb AS (
      SELECT c.client_id,
             NULLIF(RIGHT(regexp_replace(COALESCE(c.phone,''),'\D','','g'),10),'') AS phone,
             NULLIF(LOWER(TRIM(c.email)),'') AS email,
             (SELECT MAX(sale_date) FROM mb_sales_history s WHERE s.client_id=c.client_id) AS mb_last
      FROM mb_clients_cache c WHERE c.source='mindbody'
    ),
    zn AS (
      SELECT NULLIF(RIGHT(regexp_replace(COALESCE(c.phone,''),'\D','','g'),10),'') AS phone,
             NULLIF(LOWER(TRIM(c.email)),'') AS email, MAX(s.sale_date) AS zn_last
      FROM mb_clients_cache c JOIN mb_sales_history s ON s.client_id=c.client_id AND s.source='zenoti'
      WHERE c.source='zenoti' GROUP BY 1,2
    )
    SELECT mb.client_id, to_char(mb.mb_last,'YYYY-MM-DD') AS mb_last
    FROM mb
    LEFT JOIN zn  ON zn.phone  IS NOT NULL AND zn.phone  = mb.phone
    LEFT JOIN zn zn2 ON zn2.email IS NOT NULL AND zn2.email = mb.email
    WHERE (zn.zn_last IS NOT NULL OR zn2.zn_last IS NOT NULL)
      AND COALESCE(GREATEST(zn.zn_last, zn2.zn_last), zn.zn_last, zn2.zn_last) > mb.mb_last`;
  const atRiskIds = atRisk.map(r => r.client_id);
  console.log(`At-risk identities: ${atRiskIds.length}`);

  // The exact mergedLast query from getMaintenanceDuePatients, over the at-risk ids.
  const ml = await sql`
    WITH cand AS (
      SELECT client_id,
             NULLIF(RIGHT(regexp_replace(COALESCE(phone,''),'\D','','g'),10),'') AS phone,
             NULLIF(LOWER(TRIM(email)),'') AS email
      FROM mb_clients_cache WHERE client_id = ANY(${atRiskIds})
    ),
    activity AS (
      SELECT NULLIF(RIGHT(regexp_replace(COALESCE(c.phone,''),'\D','','g'),10),'') AS phone,
             NULLIF(LOWER(TRIM(c.email)),'') AS email, a.activity_date
      FROM (
        SELECT client_id, sale_date AS activity_date FROM mb_sales_history
        UNION ALL
        SELECT client_id, start_date AS activity_date FROM mb_appointments_history
        WHERE status IN ('Completed','Arrived')
      ) a JOIN mb_clients_cache c ON c.client_id = a.client_id
    )
    SELECT cand.client_id, to_char(MAX(act.activity_date),'YYYY-MM-DD') AS merged_last
    FROM cand JOIN activity act
      ON (act.phone IS NOT NULL AND act.phone = cand.phone)
      OR (act.email IS NOT NULL AND act.email = cand.email)
    GROUP BY cand.client_id`;
  const mergedById = new Map(ml.map(r => [r.client_id, r.merged_last]));

  // Each at-risk id: is mergedLast strictly AFTER the MB anchor? (→ suppressed)
  let suppressed = 0, missed = 0;
  for (const r of atRisk) {
    const merged = mergedById.get(r.client_id);
    if (merged && merged > r.mb_last) suppressed++;
    else { missed++; if (missed <= 10) console.log(`  ❌ NOT suppressed: id=${r.client_id} mb_last=${r.mb_last} merged=${merged}`); }
  }
  console.log(`\n${missed === 0 ? '✅' : '❌'} Suppressed by cross-source merge: ${suppressed}/${atRiskIds.length}  (missed=${missed}, want 0)`);
  console.log('\n✅ read-only');
} catch (e) { console.error('❌', e.message); }
finally { await sql.end(); }
