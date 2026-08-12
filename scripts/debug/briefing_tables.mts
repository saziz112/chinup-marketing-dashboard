/** Regenerate both briefing tables from live data. Read-only. */
import { sql } from '@/lib/db/sql';
import { getLeadSourceReport } from '@/lib/lead-sources';
import { resolveChannel } from '@/lib/attribution';

function tagList(raw: unknown): string[] {
  let v = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return []; } }
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

async function main() {
  const rep = await getLeadSourceReport({ minAgeDays: 30, maxAgeDays: 180, maturationDays: 30, location: null });
  console.log('=== TABLE 1: new leads ===');
  for (const x of rep.rows) {
    console.log([x.channel, x.newLeads, x.purchased,
      x.purchaseRate === null ? '—' : Math.round(x.purchaseRate * 100) + '%',
      '$' + Math.round(x.revenue).toLocaleString(),
      x.revPerLead === null ? '—' : '$' + Math.round(x.revPerLead)].join(' | '));
  }
  const t = rep.totals;
  console.log(['TOTAL', t.newLeads, t.purchased, Math.round(t.purchased / t.newLeads * 100) + '%',
    '$' + Math.round(t.revenue).toLocaleString(), '$' + Math.round(t.revenue / t.newLeads)].join(' | '));

  const r = await sql<{
    source: string | null; attribution_source: Record<string, unknown> | null;
    tags: unknown; client_id: string | null; purchased: boolean; revenue: string;
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
    SELECT m.source, m.attribution_source, m.tags, m.client_id,
      COALESCE((SELECT true FROM mb_sales_history s WHERE s.client_id=m.client_id
                 AND s.sale_date >= m.created_at::date
                 AND s.sale_date < (m.created_at + interval '30 days')::date LIMIT 1),false) AS purchased,
      (SELECT COALESCE(SUM(s.total_amount),0) FROM mb_sales_history s WHERE s.client_id=m.client_id
         AND s.sale_date >= m.created_at::date
         AND s.sale_date < (m.created_at + interval '30 days')::date) AS revenue
    FROM matched m`;

  const m = new Map<string, { all: number; matched: number; showed: number; rev: number }>();
  for (const x of r.rows) {
    const ch = resolveChannel(x.source, x.attribution_source as never, tagList(x.tags));
    if (!m.has(ch)) m.set(ch, { all: 0, matched: 0, showed: 0, rev: 0 });
    const a = m.get(ch)!;
    a.all++;
    if (x.client_id) { a.matched++; if (x.purchased) a.showed++; a.rev += Number(x.revenue || 0); }
  }
  console.log('\n=== TABLE 2: matched-only ===');
  for (const [k, v] of [...m.entries()].sort((a, b) => b[1].matched - a[1].matched)) {
    console.log([k, v.all, v.matched, Math.round(v.matched / v.all * 100) + '%',
      v.matched ? Math.round(v.showed / v.matched * 100) + '%' : '—',
      v.matched ? '$' + Math.round(v.rev / v.matched) : '—'].join(' | '));
  }
  process.exit(0);
}
main();
