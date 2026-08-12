/**
 * Is the patient match rate biased BY CHANNEL? If phone-bearing channels match
 * better than email-only ones, measured purchase rate is partly an artifact of
 * identifiability, not performance -- and the channel ranking is not safe to
 * act on. Read-only.
 */
import { sql } from '@/lib/db/sql';
import { resolveChannel } from '@/lib/attribution';

function tagList(raw: unknown): string[] {
  let v = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return []; } }
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

type Row = {
  contact_id: string; source: string | null; attribution_source: string | null;
  tags: unknown; phone_normalized: string | null; email: string | null;
  client_id: string | null; matched_by: string | null;
  same_day_before_lead: boolean;
};

async function main() {
  const FROM = '2026-05-01', TO = '2026-08-01'; // 3 fully-matured-ish months

  const r = await sql<Row>`
    WITH deduped AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(phone_normalized, ''), NULLIF(email, ''), contact_id))
             contact_id, phone_normalized, email, source, attribution_source, tags, created_at
        FROM ghl_contacts_map
       WHERE created_at >= ${FROM}::date AND created_at < ${TO}::date
       ORDER BY COALESCE(NULLIF(phone_normalized, ''), NULLIF(email, ''), contact_id), created_at ASC
    ),
    matched AS (
      SELECT DISTINCT ON (d.contact_id)
             d.*, c.client_id,
             CASE WHEN d.phone_normalized IS NOT NULL AND d.phone_normalized <> ''
                   AND right(regexp_replace(c.phone, '\\D', '', 'g'), 10) = right(d.phone_normalized, 10)
                  THEN 'phone' WHEN c.client_id IS NOT NULL THEN 'email' ELSE NULL END AS matched_by
        FROM deduped d
        LEFT JOIN mb_clients_cache c
          ON ( d.phone_normalized IS NOT NULL AND d.phone_normalized <> ''
               AND right(regexp_replace(c.phone, '\\D', '', 'g'), 10) = right(d.phone_normalized, 10) )
          OR ( d.email IS NOT NULL AND d.email <> '' AND lower(c.email) = lower(d.email) )
       ORDER BY d.contact_id,
                (d.phone_normalized IS NOT NULL
                 AND right(regexp_replace(c.phone, '\\D', '', 'g'), 10) = right(d.phone_normalized, 10)) DESC,
                c.creation_date ASC NULLS LAST
    )
    SELECT m.contact_id, m.source, m.attribution_source, m.tags,
           m.phone_normalized, m.email, m.client_id, m.matched_by,
           COALESCE((
             SELECT true FROM mb_sales_history s
              WHERE s.client_id = m.client_id
                AND s.sale_date = m.created_at::date
                AND s.sale_date < m.created_at::date + 1
              LIMIT 1), false) AS same_day_before_lead
      FROM matched m
  `;

  type Agg = { n: number; hasPhone: number; hasEmail: number; matched: number; byPhone: number; byEmail: number; sameDay: number };
  const agg = new Map<string, Agg>();
  const bump = (k: string): Agg => {
    let a = agg.get(k);
    if (!a) { a = { n: 0, hasPhone: 0, hasEmail: 0, matched: 0, byPhone: 0, byEmail: 0, sameDay: 0 }; agg.set(k, a); }
    return a;
  };

  for (const row of r.rows) {
    const ch = resolveChannel(row.source, row.attribution_source as never, tagList(row.tags));
    for (const a of [bump(ch), bump('ALL')]) {
      a.n++;
      if (row.phone_normalized) a.hasPhone++;
      if (row.email) a.hasEmail++;
      if (row.client_id) { a.matched++; if (row.matched_by === 'phone') a.byPhone++; else a.byEmail++; }
      if (row.same_day_before_lead) a.sameDay++;
    }
  }

  const pct = (x: number, n: number) => n ? `${(x / n * 100).toFixed(0)}%` : '-';
  console.log(`Window ${FROM} -> ${TO}  (${r.rows.length} deduped people)\n`);
  console.log('channel              n    has-ph  has-em  MATCHED  via-ph  via-em  same-day-sale');
  const order = [...agg.entries()].sort((a, b) => b[1].n - a[1].n);
  for (const [k, a] of order) {
    console.log(
      `${k.padEnd(18)} ${String(a.n).padStart(4)}  ${pct(a.hasPhone, a.n).padStart(6)}  ${pct(a.hasEmail, a.n).padStart(6)}  ` +
      `${pct(a.matched, a.n).padStart(7)}  ${String(a.byPhone).padStart(6)}  ${String(a.byEmail).padStart(6)}  ${String(a.sameDay).padStart(6)}`);
  }
  process.exit(0);
}
main();
