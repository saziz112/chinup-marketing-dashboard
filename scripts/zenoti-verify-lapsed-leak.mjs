/**
 * DEFINITIVE P3 check (READ-ONLY): run the EXACT lapsed query and confirm none of
 * the Zenoti-active patients (or their phone/email-matched MindBody identities)
 * leak into the lapsed segment. This is the bug we shipped to fix.
 * Run: node --env-file=.env.local scripts/zenoti-verify-lapsed-leak.mjs
 */
import postgres from 'postgres';
const url = process.env.SBNEW_POSTGRES_URL || process.env.POSTGRES_URL;
const sql = postgres(url, { ssl: 'require', max: 2 });
const MIN_DAYS = 60;

try {
  // Exact lapsed query (mirrors getLapsedPatientsFromDB), returns lapsed client_ids + contact
  const lapsed = await sql`
    WITH client_activity AS (
      SELECT client_id, sale_date AS activity_date FROM mb_sales_history
      UNION ALL
      SELECT client_id, start_date AS activity_date FROM mb_appointments_history
      WHERE status IN ('Completed','Arrived')
    ),
    future_booked AS (
      SELECT DISTINCT client_id FROM mb_appointments_history
      WHERE status IN ('Booked','Confirmed') AND start_date > NOW()
    ),
    active_contacts AS (
      SELECT DISTINCT
        NULLIF(LOWER(TRIM(c.email)),'') AS email,
        NULLIF(RIGHT(regexp_replace(COALESCE(c.phone,''),'\D','','g'),10),'') AS phone
      FROM mb_clients_cache c
      WHERE c.client_id IN (
        SELECT DISTINCT client_id FROM client_activity
        WHERE activity_date > NOW() - make_interval(days => ${MIN_DAYS})
      )
    )
    SELECT a.client_id,
           NULLIF(RIGHT(regexp_replace(COALESCE(c.phone,''),'\D','','g'),10),'') AS phone,
           NULLIF(LOWER(TRIM(c.email)),'') AS email
    FROM client_activity a
    LEFT JOIN mb_clients_cache c ON c.client_id = a.client_id
    WHERE a.client_id NOT IN (SELECT client_id FROM future_booked)
      AND NOT EXISTS (
        SELECT 1 FROM active_contacts ac
        WHERE (ac.phone IS NOT NULL AND ac.phone = NULLIF(RIGHT(regexp_replace(COALESCE(c.phone,''),'\D','','g'),10),''))
           OR (ac.email IS NOT NULL AND ac.email = NULLIF(LOWER(TRIM(c.email)),''))
      )
    GROUP BY a.client_id, c.phone, c.email
    HAVING EXTRACT(DAY FROM NOW() - MAX(a.activity_date))::INTEGER >= ${MIN_DAYS}
  `;
  console.log(`Lapsed segment size (minDays=${MIN_DAYS}): ${lapsed.length}`);

  // Zenoti-active contacts (phone last-10 + email)
  const zActive = await sql`
    SELECT DISTINCT
      NULLIF(RIGHT(regexp_replace(COALESCE(c.phone,''),'\D','','g'),10),'') AS phone,
      NULLIF(LOWER(TRIM(c.email)),'') AS email
    FROM mb_clients_cache c
    WHERE c.source='zenoti'
      AND c.client_id IN (SELECT DISTINCT client_id FROM mb_sales_history WHERE source='zenoti')`;
  const zPhones = new Set(zActive.map(r => r.phone).filter(Boolean));
  const zEmails = new Set(zActive.map(r => r.email).filter(Boolean));

  // Any lapsed row whose phone/email matches a Zenoti-active patient = LEAK (bug)
  const leaks = lapsed.filter(r => (r.phone && zPhones.has(r.phone)) || (r.email && zEmails.has(r.email)));
  console.log(`\n${leaks.length === 0 ? '✅' : '❌'} Zenoti-active patients leaking into lapsed: ${leaks.length} (want 0)`);
  for (const l of leaks.slice(0, 20)) console.log(`   LEAK client_id=${l.client_id} ph=${l.phone} em=${l.email}`);

  // Also: any lapsed row that IS a zenoti-source client_id? (should be 0 — all zenoti active are recent)
  const znLapsed = await sql`
    SELECT COUNT(*)::int AS n FROM mb_clients_cache WHERE source='zenoti' AND client_id = ANY(${lapsed.map(r=>r.client_id)})`;
  console.log(`${znLapsed[0].n === 0 ? '✅' : '❌'} Zenoti-source client_ids in lapsed: ${znLapsed[0].n} (want 0)`);

  console.log('\n✅ read-only');
} catch (e) { console.error('❌', e.message); }
finally { await sql.end(); }
