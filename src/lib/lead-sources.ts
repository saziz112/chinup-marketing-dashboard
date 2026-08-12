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
  /** jsonb, but the sync writes it double-encoded on some rows — see tagList. */
  tags: unknown;
  had_prior_purchase: boolean;
  showed: boolean;
  revenue: string | null;
}

/**
 * `ghl_contacts_map.tags` is jsonb, but the sync writes it with
 * JSON.stringify() on some rows, so it lands as a jsonb *string* holding an
 * array rather than a jsonb array. Read both shapes rather than repairing in
 * SQL — a read path should not depend on which write produced the row.
 */
function tagList(raw: unknown): string[] {
  let v = raw;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
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

  // The shim returns { rows, rowCount, command }, not an array — read .rows,
  // as every other call site does. Casting the wrapper straight to an array
  // type compiles but throws "not iterable" at runtime on the loop below.
  const result = await sql<RawLeadRow>`
    WITH deduped AS (
      -- Rule 1: one row per PERSON, not per sub-account record.
      SELECT DISTINCT ON (COALESCE(NULLIF(phone_normalized, ''), NULLIF(email, ''), contact_id))
             contact_id,
             phone_normalized,
             email,
             source,
             attribution_source,
             attribution_synced_at,
             tags,
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
        -- The match expressions below must stay byte-identical to the
        -- functional indexes idx_mb_clients_phone_last10 and
        -- idx_mb_clients_email_lower, or Postgres sequentially scans
        -- mb_clients_cache per lead: 14.6s vs 149ms (measured 2026-08-12).
        --
        -- Byte-identical includes the REGEX ESCAPE. In a JS/TS template
        -- literal '\D' cooks to 'D' (unknown escapes drop the backslash), so
        -- a .mjs helper that writes '\D' silently builds an index on
        -- regexp_replace(phone,'D',...) -- stripping the letter D, not
        -- non-digits. That index can never match this query, and it also
        -- makes ad-hoc timing scripts look 60x faster than reality. Write
        -- '\\D' in JS/TS. This file is correct; verify with:
        --   SELECT indexdef FROM pg_indexes
        --    WHERE indexname = 'idx_mb_clients_phone_last10';
        --
        -- Do NOT reintroduce a length(...) guard here: it is redundant
        -- (right('1',10) cannot equal a 10-digit string) and it prevents the
        -- index from being used.
        LEFT JOIN mb_clients_cache c
          ON (
               d.phone_normalized IS NOT NULL AND d.phone_normalized <> ''
               AND right(regexp_replace(c.phone, '\\D', '', 'g'), 10) = right(d.phone_normalized, 10)
             )
          OR (
               d.email IS NOT NULL AND d.email <> ''
               AND lower(c.email) = lower(d.email)
             )
       ORDER BY d.contact_id,
                -- prefer a phone match over an email match, then oldest record
                (d.phone_normalized IS NOT NULL
                 AND right(regexp_replace(c.phone, '\\D', '', 'g'), 10) = right(d.phone_normalized, 10)) DESC,
                c.creation_date ASC NULLS LAST
    )
    SELECT m.contact_id,
           m.source,
           m.attribution_source,
           m.attribution_synced_at,
           m.tags,
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
  `;
  const raw = result.rows;

  const byChannel = new Map<Channel, LeadSourceRow>();
  let unbackfilled = 0;

  for (const r of raw) {
    if (!r.attribution_synced_at) unbackfilled++;

    const channel = resolveChannel(r.source, r.attribution_source, tagList(r.tags));
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
