/**
 * Lead-source funnel query (PLAN item 22).
 *
 * Implements the five non-negotiable rules from
 * docs/superpowers/specs/2026-08-10-lead-source-tracking-design.md. Each one
 * changed the answer during validation; none is a style preference.
 *
 *   1. Deduplicate per person, never sum sub-accounts ("All Locations" forms
 *      create a contact in every location -> ~3x overcount).
 *   2. One client match per contact (DISTINCT ON) -> fan-out reported $284k
 *      against a true $172k.
 *   3. Separate existing patients from new leads.
 *   4. Equal maturation: every lead gets the same number of days to convert.
 *   5. Never read source or outcome from the Leads Pipeline.
 */

import { sql } from '@/lib/db/sql';
import {
  resolveChannel,
  MIN_REPORTABLE_N,
  type AttributionSource,
  type Channel,
} from '@/lib/attribution';

export interface LeadSourceRow {
  channel: Channel;
  leads: number;
  newLeads: number;
  existingPatients: number;
  showed: number;
  /** null when newLeads < MIN_REPORTABLE_N — too small to quote a rate. */
  showRate: number | null;
  revenue: number;
  revPerLead: number | null;
  /** True when the row is below the reporting threshold. */
  suppressed: boolean;
}

export interface LeadSourceReport {
  rows: LeadSourceRow[];
  totals: {
    leads: number;
    newLeads: number;
    showed: number;
    revenue: number;
  };
  window: {
    cohortStart: string;
    cohortEnd: string;
    maturationDays: number;
    location: string | null;
  };
  /** Contacts in window with no attribution row yet — backfill coverage gap. */
  unbackfilled: number;
  generatedAt: string;
}

interface RawLeadRow {
  contact_id: string;
  source: string | null;
  attribution_source: AttributionSource | null;
  attribution_synced_at: Date | null;
  had_prior_purchase: boolean;
  showed: boolean;
  revenue: string | null;
}

export interface LeadSourceParams {
  /** Lower bound on lead age, in days. Spec default 30. */
  minAgeDays?: number;
  /** Upper bound on lead age, in days. Spec default 90. */
  maxAgeDays?: number;
  /** Days each lead is given to convert. Spec default 30. */
  maturationDays?: number;
  /** 'decatur' | 'kennesaw' | 'smyrna', or null for all (deduped). */
  location?: string | null;
}

export async function getLeadSourceReport(
  params: LeadSourceParams = {},
): Promise<LeadSourceReport> {
  const minAge = params.minAgeDays ?? 30;
  const maxAge = params.maxAgeDays ?? 90;
  const maturation = params.maturationDays ?? 30;
  const location = params.location ?? null;

  const raw = (await sql`
    WITH deduped AS (
      -- Rule 1: one row per PERSON, not per sub-account record.
      SELECT DISTINCT ON (COALESCE(NULLIF(phone_normalized, ''), NULLIF(email, ''), contact_id))
             contact_id,
             phone_normalized,
             email,
             source,
             attribution_source,
             attribution_synced_at,
             created_at
        FROM ghl_contacts_map
       WHERE created_at <  now() - (${minAge} || ' days')::interval
         AND created_at >= now() - (${maxAge} || ' days')::interval
         AND (${location}::text IS NULL OR location_key = ${location})
       ORDER BY COALESCE(NULLIF(phone_normalized, ''), NULLIF(email, ''), contact_id),
                created_at ASC
    ),
    matched AS (
      -- Rule 2: at most ONE client per contact, or revenue fans out.
      SELECT DISTINCT ON (d.contact_id)
             d.*,
             c.client_id
        FROM deduped d
        LEFT JOIN mb_clients_cache c
          ON (
               d.phone_normalized IS NOT NULL AND d.phone_normalized <> ''
               AND length(regexp_replace(c.phone, '\\D', '', 'g')) >= 10
               AND right(regexp_replace(c.phone, '\\D', '', 'g'), 10) = right(d.phone_normalized, 10)
             )
          OR (
               d.email IS NOT NULL AND d.email <> ''
               AND lower(c.email) = lower(d.email)
             )
       ORDER BY d.contact_id,
                -- prefer a phone match over an email match, then oldest record
                (d.phone_normalized IS NOT NULL
                 AND length(regexp_replace(c.phone, '\\D', '', 'g')) >= 10
                 AND right(regexp_replace(c.phone, '\\D', '', 'g'), 10) = right(d.phone_normalized, 10)) DESC,
                c.creation_date ASC NULLS LAST
    )
    SELECT m.contact_id,
           m.source,
           m.attribution_source,
           m.attribution_synced_at,
           -- Rule 3: a lead is someone with no purchase BEFORE the lead date.
           COALESCE((
             SELECT true FROM mb_sales_history s
              WHERE s.client_id = m.client_id
                AND s.sale_date < m.created_at::date
              LIMIT 1
           ), false) AS had_prior_purchase,
           -- Rule 4: identical maturation window for every lead.
           COALESCE((
             SELECT true FROM mb_appointments_history a
              WHERE a.client_id = m.client_id
                AND a.status IN ('Completed', 'Arrived')
                AND a.start_date >= m.created_at
                AND a.start_date <  m.created_at + (${maturation} || ' days')::interval
              LIMIT 1
           ), false) AS showed,
           (
             SELECT COALESCE(SUM(s.total_amount), 0) FROM mb_sales_history s
              WHERE s.client_id = m.client_id
                AND s.sale_date >= m.created_at::date
                AND s.sale_date <  (m.created_at + (${maturation} || ' days')::interval)::date
           ) AS revenue
      FROM matched m
  `) as unknown as RawLeadRow[];

  const byChannel = new Map<Channel, LeadSourceRow>();
  let unbackfilled = 0;

  for (const r of raw) {
    if (!r.attribution_synced_at) unbackfilled++;

    const channel = resolveChannel(r.source, r.attribution_source);
    let row = byChannel.get(channel);
    if (!row) {
      row = {
        channel,
        leads: 0,
        newLeads: 0,
        existingPatients: 0,
        showed: 0,
        showRate: null,
        revenue: 0,
        revPerLead: null,
        suppressed: false,
      };
      byChannel.set(channel, row);
    }

    row.leads++;
    if (r.had_prior_purchase) {
      // Rule 3: existing patients are counted but never credited as leads.
      row.existingPatients++;
      continue;
    }
    row.newLeads++;
    if (r.showed) row.showed++;
    row.revenue += Number(r.revenue || 0);
  }

  const rows = [...byChannel.values()].map((row) => {
    // Honesty requirement: suppress rates on rows too small to support them.
    const suppressed = row.newLeads < MIN_REPORTABLE_N;
    return {
      ...row,
      suppressed,
      showRate: suppressed ? null : row.showed / row.newLeads,
      revPerLead: suppressed ? null : row.revenue / row.newLeads,
    };
  });

  rows.sort((a, b) => b.newLeads - a.newLeads);

  return {
    rows,
    totals: {
      leads: rows.reduce((n, r) => n + r.leads, 0),
      newLeads: rows.reduce((n, r) => n + r.newLeads, 0),
      showed: rows.reduce((n, r) => n + r.showed, 0),
      revenue: rows.reduce((n, r) => n + r.revenue, 0),
    },
    window: {
      cohortStart: `${maxAge} days ago`,
      cohortEnd: `${minAge} days ago`,
      maturationDays: maturation,
      location,
    },
    unbackfilled,
    generatedAt: new Date().toISOString(),
  };
}
