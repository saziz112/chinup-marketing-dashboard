/**
 * READ-ONLY: prove the new identity-expanded futureBooked query bridges a patient's
 * MindBody id to their Zenoti-GUID record. Picks real phone/email-matched cross-source
 * pairs and confirms the peers CTE links them. Once a future Zenoti booking lands under
 * the GUID, this bridge makes the maintenance suppression see it under the MindBody id.
 * Run: node --env-file=.env.local scripts/verify-futurebooked-peers.mjs
 */
import postgres from 'postgres';
const url = process.env.SBNEW_POSTGRES_URL || process.env.POSTGRES_URL;
const sql = postgres(url, { ssl: 'require', max: 2 });
try {
  // Find MindBody ids that have a Zenoti peer by phone/email — the exact peers CTE.
  const pairs = await sql`
    WITH cand AS (
      SELECT client_id,
             NULLIF(RIGHT(regexp_replace(COALESCE(phone,''),'\D','','g'),10),'') AS phone,
             NULLIF(LOWER(TRIM(email)),'') AS email
      FROM mb_clients_cache WHERE source='mindbody'
    ),
    peers AS (
      SELECT DISTINCT cand.client_id AS mb_id, c.client_id AS peer_id, c.source AS peer_source
      FROM cand JOIN mb_clients_cache c
        ON (cand.phone IS NOT NULL AND NULLIF(RIGHT(regexp_replace(COALESCE(c.phone,''),'\D','','g'),10),'') = cand.phone)
        OR (cand.email IS NOT NULL AND NULLIF(LOWER(TRIM(c.email)),'') = cand.email)
    )
    SELECT mb_id, peer_id, peer_source FROM peers WHERE peer_source='zenoti' LIMIT 10`;
  console.log(`MindBody candidates with a Zenoti-GUID peer (bridge works): ${pairs.length ? pairs.length + '+ found' : 'NONE'}`);
  for (const p of pairs.slice(0,8)) console.log(`  MB ${p.mb_id}  ⇄  Zenoti ${p.peer_id}`);

  // Count total distinct MB ids that would gain visibility into a Zenoti-side booking
  const cnt = await sql`
    WITH cand AS (
      SELECT client_id,
             NULLIF(RIGHT(regexp_replace(COALESCE(phone,''),'\D','','g'),10),'') AS phone,
             NULLIF(LOWER(TRIM(email)),'') AS email
      FROM mb_clients_cache WHERE source='mindbody'
    )
    SELECT COUNT(DISTINCT cand.client_id) AS n
    FROM cand JOIN mb_clients_cache c
      ON c.source='zenoti' AND (
        (cand.phone IS NOT NULL AND NULLIF(RIGHT(regexp_replace(COALESCE(c.phone,''),'\D','','g'),10),'') = cand.phone)
        OR (cand.email IS NOT NULL AND NULLIF(LOWER(TRIM(c.email)),'') = cand.email))`;
  console.log(`\nDistinct MindBody patients bridged to a Zenoti identity: ${cnt[0].n}`);
  console.log('(These are the patients whose future Zenoti bookings the fix will now see.)');
  console.log('\n(read-only)');
} catch (e) { console.error('❌', e.message); }
finally { await sql.end(); }
