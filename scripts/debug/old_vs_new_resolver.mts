/**
 * Same rows, same moment: resolveChannel WITHOUT tags (= pre-change behaviour)
 * vs WITH tags. Isolates the Call-In change from data drift between runs.
 */
import { sql } from '@/lib/db/sql';
import { resolveChannel } from '@/lib/attribution';

function tagList(raw: unknown): string[] {
  let v = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return []; } }
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

async function main() {
  const r = await sql<{
    source: string | null; attribution_source: Record<string, unknown> | null;
    tags: unknown; showed: boolean; revenue: string;
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
      SELECT DISTINCT ON (d.contact_id) d.*, c.client_id
        FROM deduped d
        LEFT JOIN mb_clients_cache c
          ON ( d.phone_normalized IS NOT NULL AND d.phone_normalized <> ''
               AND right(regexp_replace(c.phone,'\\D','','g'),10) = right(d.phone_normalized,10) )
          OR ( d.email IS NOT NULL AND d.email <> '' AND lower(c.email) = lower(d.email) )
       ORDER BY d.contact_id,
                (d.phone_normalized IS NOT NULL
                 AND right(regexp_replace(c.phone,'\\D','','g'),10) = right(d.phone_normalized,10)) DESC,
                c.creation_date ASC NULLS LAST
    )
    SELECT m.source, m.attribution_source, m.tags,
      COALESCE((SELECT true FROM mb_appointments_history a WHERE a.client_id=m.client_id
                 AND a.status IN ('Completed','Arrived') AND a.start_date >= m.created_at
                 AND a.start_date < m.created_at + interval '30 days' LIMIT 1),false) AS showed,
      (SELECT COALESCE(SUM(s.total_amount),0) FROM mb_sales_history s WHERE s.client_id=m.client_id
         AND s.sale_date >= m.created_at::date
         AND s.sale_date < (m.created_at + interval '30 days')::date) AS revenue
    FROM matched m`;

  type A = { n: number; showed: number; rev: number };
  const roll = (useTags: boolean) => {
    const m = new Map<string, A>();
    for (const x of r.rows) {
      const ch = useTags
        ? resolveChannel(x.source, x.attribution_source as never, tagList(x.tags))
        : resolveChannel(x.source, x.attribution_source as never);
      if (!m.has(ch)) m.set(ch, { n: 0, showed: 0, rev: 0 });
      const a = m.get(ch)!;
      a.n++; if (x.showed) a.showed++; a.rev += Number(x.revenue || 0);
    }
    return m;
  };
  const before = roll(false), after = roll(true);
  console.log('channel            before(n/showed/rev)        after(n/showed/rev)');
  for (const k of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const b = before.get(k), a = after.get(k);
    const f = (x?: A) => x ? `${String(x.n).padStart(5)}/${String(x.showed).padStart(4)}/$${Math.round(x.rev).toLocaleString().padStart(8)}` : '            —';
    const flag = JSON.stringify(b) === JSON.stringify(a) ? '' : '   <-- CHANGED';
    console.log(`${k.padEnd(16)} ${f(b)}   ${f(a)}${flag}`);
  }
  process.exit(0);
}
main();
