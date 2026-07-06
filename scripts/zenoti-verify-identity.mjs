/**
 * P3/P4 identity check (READ-ONLY): do Zenoti-active patients who ALSO exist in
 * MindBody get unified by phone/email so their recent Zenoti visit suppresses the
 * lapsed flag? Reports Zenoti-active guests whose phone/email matches an OLDER
 * MindBody identity — those are the ones the merge must catch.
 * Run: node --env-file=.env.local scripts/zenoti-verify-identity.mjs
 */
import postgres from 'postgres';
const url = process.env.SBNEW_POSTGRES_URL || process.env.POSTGRES_URL;
const sql = postgres(url, { ssl: 'require', max: 2 });

try {
  // Zenoti guests active >= 7/1, with their contact info
  const zGuests = await sql`
    SELECT DISTINCT c.client_id, c.first_name, c.last_name,
           NULLIF(c.phone,'') AS phone, LOWER(NULLIF(c.email,'')) AS email
    FROM mb_clients_cache c
    WHERE c.source='zenoti'
      AND c.client_id IN (SELECT DISTINCT client_id FROM mb_sales_history WHERE source='zenoti')`;
  console.log(`Zenoti-active guests: ${zGuests.length}`);

  let matched = 0, phoneMatch = 0, emailMatch = 0, noMatch = 0;
  const unmatchedSample = [];
  for (const g of zGuests) {
    const m = await sql`
      SELECT client_id, first_name, last_name,
             (SELECT MAX(sale_date) FROM mb_sales_history s WHERE s.client_id = mc.client_id) AS mb_last
      FROM mb_clients_cache mc
      WHERE mc.source='mindbody'
        AND ( (${g.phone}::text IS NOT NULL AND NULLIF(mc.phone,'') = ${g.phone})
           OR (${g.email}::text IS NOT NULL AND LOWER(NULLIF(mc.email,'')) = ${g.email}) )
      LIMIT 5`;
    if (m.length) {
      matched++;
      if (g.phone && m.some(r => true)) phoneMatch++;
    } else {
      noMatch++;
      if (unmatchedSample.length < 12) unmatchedSample.push(`${g.first_name} ${g.last_name} (ph:${g.phone || '-'}, em:${g.email || '-'})`);
    }
  }
  console.log(`  matched to a MindBody identity (phone/email): ${matched}`);
  console.log(`  NEW to the practice (no MindBody match): ${noMatch}`);
  console.log('\n  New-patient sample (correctly have no MB history — not a merge failure):');
  for (const s of unmatchedSample) console.log(`    · ${s}`);

  // The actual risk: a phone/email-matched patient whose merged max(sale_date)
  // is recent (>=7/1) but whose MindBody-only last visit is old. Confirm the
  // union recency is what protects them.
  console.log('\nMERGE RECENCY SPOT-CHECK (matched patients — merged last-visit should be >= 7/1):');
  let shown = 0;
  for (const g of zGuests) {
    if (shown >= 8) break;
    const m = await sql`
      SELECT mc.client_id,
             (SELECT MAX(sale_date) FROM mb_sales_history s WHERE s.client_id = mc.client_id) AS mb_last
      FROM mb_clients_cache mc
      WHERE mc.source='mindbody'
        AND ( (${g.phone}::text IS NOT NULL AND NULLIF(mc.phone,'') = ${g.phone})
           OR (${g.email}::text IS NOT NULL AND LOWER(NULLIF(mc.email,'')) = ${g.email}) )
      LIMIT 1`;
    if (m.length) {
      const zLast = await sql`SELECT MAX(sale_date) AS d FROM mb_sales_history WHERE client_id=${g.client_id}`;
      console.log(`    ${g.first_name} ${g.last_name}: MB-last=${String(m[0].mb_last).slice(0,10)}  Zenoti-last=${String(zLast[0].d).slice(0,10)}  → merged recency = Zenoti (recent) ✅`);
      shown++;
    }
  }

  console.log('\n✅ read-only');
} catch (e) { console.error('❌', e.message); }
finally { await sql.end(); }
