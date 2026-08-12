/**
 * DRY RUN ONLY — writes nothing.
 * If we reclassified "Other" contacts carrying call-handling tags as Call-In,
 * what would change? Criteria proposed for review before any code change.
 */
import { sql } from '@/lib/db/sql';
import { resolveChannel } from '@/lib/attribution';

const CALL_TAGS = [/couldn'?t find caller name/i, /name via lookup/i];

function tagList(raw: unknown): string[] {
  if (!raw) return [];
  let v: unknown = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return []; } }
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
}

async function main() {
  const r = await sql<{
    source: string | null; attribution_source: Record<string, unknown> | null;
    tags: unknown; client_id: string | null; had_prior: boolean; showed: boolean; revenue: string;
  }>`
    WITH deduped AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(phone_normalized,''), NULLIF(email,''), contact_id))
             contact_id, phone_normalized, email, source, attribution_source, tags, created_at
        FROM ghl_contacts_map
       WHERE created_at <  now() - interval '30 days'
         AND created_at >= now() - interval '180 days'
       ORDER BY COALESCE(NULLIF(phone_normalized,''), NULLIF(email,''), contact_id), created_at ASC
    ),
    matched AS (
      SELECT d.*, c.client_id FROM deduped d
      LEFT JOIN LATERAL (
        SELECT x.client_id FROM mb_clients_cache x
         WHERE d.phone_normalized IS NOT NULL AND d.phone_normalized <> ''
           AND right(regexp_replace(x.phone,'\\D','','g'),10) = right(d.phone_normalized,10)
        UNION ALL
        SELECT x.client_id FROM mb_clients_cache x
         WHERE d.email IS NOT NULL AND d.email <> '' AND lower(x.email) = lower(d.email)
         LIMIT 1) c ON true
    )
    SELECT m.source, m.attribution_source, m.tags, m.client_id,
      COALESCE((SELECT true FROM mb_sales_history s WHERE s.client_id=m.client_id
                 AND s.sale_date < m.created_at::date LIMIT 1),false) AS had_prior,
      COALESCE((SELECT true FROM mb_appointments_history a WHERE a.client_id=m.client_id
                 AND a.status IN ('Completed','Arrived') AND a.start_date >= m.created_at
                 AND a.start_date < m.created_at + interval '30 days' LIMIT 1),false) AS showed,
      (SELECT COALESCE(SUM(s.total_amount),0) FROM mb_sales_history s WHERE s.client_id=m.client_id
         AND s.sale_date >= m.created_at::date
         AND s.sale_date < (m.created_at + interval '30 days')::date) AS revenue
    FROM matched m`;

  type A = { newLeads: number; showed: number; revenue: number };
  const before = new Map<string, A>(), after = new Map<string, A>();
  const add = (m: Map<string, A>, k: string, x: typeof r.rows[number]) => {
    if (!m.has(k)) m.set(k, { newLeads: 0, showed: 0, revenue: 0 });
    const a = m.get(k)!;
    if (x.had_prior) return;
    a.newLeads++;
    if (x.showed) a.showed++;
    a.revenue += Number(x.revenue || 0);
  };

  let moved = 0;
  for (const x of r.rows) {
    const ch = resolveChannel(x.source, x.attribution_source as never);
    add(before, ch, x);
    let next = ch;
    if (ch === 'Other') {
      const tags = tagList(x.tags);
      if (tags.some((t) => CALL_TAGS.some((re) => re.test(t)))) { next = 'Call-In'; moved++; }
    }
    add(after, next, x);
  }

  const fmt = (a: A | undefined) =>
    a ? `${String(a.newLeads).padStart(5)} leads  ${String(a.showed).padStart(4)} shown  ` +
        `${(a.newLeads ? (a.showed / a.newLeads * 100).toFixed(0) : '0').padStart(3)}%  ` +
        `$${Math.round(a.revenue).toLocaleString().padStart(9)}` : '—';

  console.log(`Contacts that would move from "Other" to "Call-In": ${moved}\n`);
  const keys = [...new Set([...before.keys(), ...after.keys()])];
  for (const k of keys.sort()) {
    const b = before.get(k), a = after.get(k);
    if (JSON.stringify(b) === JSON.stringify(a)) continue;
    console.log(`${k}`);
    console.log(`   before  ${fmt(b)}`);
    console.log(`   after   ${fmt(a)}`);
  }
  console.log('\nUnchanged channels omitted. NOTHING WAS WRITTEN.');
  process.exit(0);
}
main();
