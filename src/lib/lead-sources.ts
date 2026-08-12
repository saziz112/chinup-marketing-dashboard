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
  /**
   * Leads who bought anything within `maturationDays` of submitting.
   *
   * This replaced an appointment-based "showed" count on 2026-08-12. Measured
   * over 400 days: 95 leads purchased with no appointment ever recorded, while
   * only 6 showed without buying. The appointment table also carries no
   * cancellation statuses. More importantly, revenue below is summed from
   * mb_sales_history, so counting conversions from appointments meant the
   * numerator and the dollars came from different tables and a channel could
   * report revenue with zero conversions.
   */
  purchased: number;
  /** null when newLeads < MIN_REPORTABLE_N — too small to quote a rate. */
  purchaseRate: number | null;
  /** Spend inside the maturation window. Comparable across cohorts. */
  revenue: number;
  /**
   * Everything the cohort has spent since submitting, uncapped. Truer, but NOT
   * comparable between cohorts: an older cohort has had longer to accrue. A
   * 30-day window captures 69% of lifetime revenue (measured 2026-08-12).
   */
  revenueToDate: number;
  revPerLead: number | null;
  /** New leads that arrived with a phone or an email — the only ones whose
   * conversion could ever be observed. */
  contactable: number;
  /** True when the row is below the reporting threshold. */
  suppressed: boolean;
  /**
   * True when too few of the channel's leads are contactable to support a
   * rate. 90% of "Social Media" leads arrive with neither phone nor email, so
   * the channel cannot register a purchase however well it performs, and its
   * near-zero rate is a property of the data, not the channel. Showing 0% here
   * invites cutting a channel for being invisible rather than for failing.
   */
  unmeasurable: boolean;
}

export interface LeadSourceReport {
  rows: LeadSourceRow[];
  totals: {
    leads: number;
    newLeads: number;
    purchased: number;
    revenue: number;
    revenueToDate: number;
  };
  window: {
    cohortStart: string;
    cohortEnd: string;
    maturationDays: number;
    location: string | null;
    /**
     * False while the newest lead in the cohort is younger than
     * maturationDays. An immature cohort understates every rate on the page —
     * the leads simply have not had time to buy yet — so the UI must say so
     * rather than let it be read as poor performance.
     */
    matured: boolean;
    /** ISO date the cohort finishes maturing, or null once it already has. */
    maturesOn: string | null;
    /**
     * Share of leads (0-1) that have already had the full maturation window.
     * Maturity is a matter of degree, not a flag: on 12 Aug a July cohort is
     * ~half grown, because only leads up to 13 July have had 30 days. Callers
     * should show this rather than a bare warning, which reads as "ignore
     * this data" when most of it is in fact final.
     */
    maturedShare: number;
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
  created_at: Date;
  had_prior_purchase: boolean;
  purchased: boolean;
  revenue: string | null;
  revenue_to_date: string | null;
  contactable: boolean;
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
  /** Lower bound on lead age, in days. Spec default 30. Ignored if from/to set. */
  minAgeDays?: number;
  /** Upper bound on lead age, in days. Spec default 90. Ignored if from/to set. */
  maxAgeDays?: number;
  /**
   * Fixed cohort bounds as YYYY-MM-DD, `to` exclusive. Prefer these over the
   * age params for anything anyone will quote: the age bounds are measured
   * from now(), so the cohort slides between page loads and totals move for
   * reasons unrelated to performance. Fixed dates reproduce.
   */
  from?: string | null;
  to?: string | null;
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

  // Fixed dates win when both are supplied; the age bounds stay for the
  // existing rolling views. Passing only one is a caller bug, not a half
  // range, so treat it as neither.
  const fixed = params.from && params.to ? { from: params.from, to: params.to } : null;

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
       WHERE (
               CASE WHEN ${fixed ? fixed.from : null}::date IS NOT NULL
                    THEN created_at >= ${fixed ? fixed.from : null}::date
                     AND created_at <  ${fixed ? fixed.to : null}::date
                    ELSE created_at <  now() - (${minAge} || ' days')::interval
                     AND created_at >= now() - (${maxAge} || ' days')::interval
               END
             )
         AND (${location}::text IS NULL OR location_key = ${location})
       ORDER BY COALESCE(NULLIF(phone_normalized, ''), NULLIF(email, ''), contact_id),
                created_at ASC
    ),
    links AS (
      -- Rule 2: a lead resolves to a PERSON, who may hold several client
      -- records. The Zenoti migration re-created 537 existing patients under
      -- new ids (73% of July's 734 "new" clients share a phone with a pre-July
      -- record), and a later purchase can land on either one. Binding each lead
      -- to a single id therefore HID purchases: 156 seen vs 192 real over
      -- 15 Jun - 1 Aug, a 19% undercount concentrated in the period people
      -- actually look at. So collect the id set here and aggregate over it
      -- below -- in scalar subqueries, which cannot fan out the way the join
      -- that once reported $284k against a true $172k did.
      SELECT d.contact_id,
             c.client_id,
             (d.phone_normalized IS NOT NULL AND d.phone_normalized <> ''
              AND right(regexp_replace(c.phone, '\\D', '', 'g'), 10) = right(d.phone_normalized, 10)) AS by_phone
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
        JOIN mb_clients_cache c
          ON (
               d.phone_normalized IS NOT NULL AND d.phone_normalized <> ''
               AND right(regexp_replace(c.phone, '\\D', '', 'g'), 10) = right(d.phone_normalized, 10)
             )
          OR (
               d.email IS NOT NULL AND d.email <> ''
               AND lower(c.email) = lower(d.email)
             )
    ),
    ids AS (
      -- A phone match wins outright when there is one. An email match alone can
      -- be a shared household address, and merging on it would fuse two people
      -- into one patient -- the same preference the old ORDER BY encoded.
      SELECT contact_id,
             COALESCE(
               array_agg(DISTINCT client_id) FILTER (WHERE by_phone),
               array_agg(DISTINCT client_id)
             ) AS client_ids
        FROM links
       GROUP BY contact_id
    ),
    matched AS (
      SELECT d.*, i.client_ids
        FROM deduped d
        LEFT JOIN ids i ON i.contact_id = d.contact_id
    )
    SELECT m.contact_id,
           m.source,
           m.attribution_source,
           m.attribution_synced_at,
           m.tags,
           m.created_at,
           -- Rule 3: a lead is someone with no purchase BEFORE the lead date.
           COALESCE((
             SELECT true FROM mb_sales_history s
              WHERE s.client_id = ANY(m.client_ids)
                AND s.sale_date < m.created_at::date
              LIMIT 1
           ), false) AS had_prior_purchase,
           -- Rule 4: identical maturation window for every lead.
           -- Conversion is a PURCHASE, from the same table as the revenue
           -- below, so the count and the dollars can never disagree.
           COALESCE((
             SELECT true FROM mb_sales_history s
              WHERE s.client_id = ANY(m.client_ids)
                AND s.sale_date >= m.created_at::date
                AND s.sale_date <  (m.created_at + (${maturation} || ' days')::interval)::date
              LIMIT 1
           ), false) AS purchased,
           (
             SELECT COALESCE(SUM(s.total_amount), 0) FROM mb_sales_history s
              WHERE s.client_id = ANY(m.client_ids)
                AND s.sale_date >= m.created_at::date
                AND s.sale_date <  (m.created_at + (${maturation} || ' days')::interval)::date
           ) AS revenue,
           -- Uncapped: everything this lead has spent since submitting. Not
           -- comparable between cohorts, so the UI must label it as such.
           (
             SELECT COALESCE(SUM(s.total_amount), 0) FROM mb_sales_history s
              WHERE s.client_id = ANY(m.client_ids)
                AND s.sale_date >= m.created_at::date
           ) AS revenue_to_date,
           -- Did this lead arrive with any way to recognise them later? A lead
           -- with neither phone nor email can never be matched to a patient, so
           -- it can never register a purchase however well the channel worked.
           --
           -- Deliberately NOT "did they match a patient record": that is
           -- circular for phone channels, where someone enters the patient
           -- database only by booking. Call-In matched 28 of 197 and 26 of
           -- those 28 bought -- which measures the database, not the channel.
           ((m.phone_normalized IS NOT NULL AND m.phone_normalized <> '')
            OR (m.email IS NOT NULL AND m.email <> '')) AS contactable
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
        purchased: 0,
        purchaseRate: null,
        revenue: 0,
        revenueToDate: 0,
        revPerLead: null,
        contactable: 0,
        suppressed: false,
        unmeasurable: false,
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
    if (r.contactable) row.contactable++;
    if (r.purchased) row.purchased++;
    row.revenue += Number(r.revenue || 0);
    row.revenueToDate += Number(r.revenue_to_date || 0);
  }

  const rows = [...byChannel.values()].map((row) => {
    // Honesty requirement: suppress rates on rows too small to support them.
    const suppressed = row.newLeads < MIN_REPORTABLE_N;
    // A rate rests on the leads we could ever follow, not on the leads that
    // arrived. Below the same threshold on THAT count, the rate is noise.
    const unmeasurable = !suppressed && row.contactable < MIN_REPORTABLE_N;
    const hide = suppressed || unmeasurable;
    return {
      ...row,
      suppressed,
      unmeasurable,
      purchaseRate: hide ? null : row.purchased / row.newLeads,
      revPerLead: hide ? null : row.revenue / row.newLeads,
    };
  });

  rows.sort((a, b) => b.newLeads - a.newLeads);

  // The newest lead in the cohort sets the date everything is final; the
  // share below says how much of the cohort is already there.
  const cohortEndDate = fixed
    ? new Date(`${fixed.to}T00:00:00Z`)
    : new Date(Date.now() - minAge * 86400000);
  const maturesOn = new Date(cohortEndDate.getTime() + maturation * 86400000);
  const matured = Date.now() >= maturesOn.getTime();

  const maturedBy = Date.now() - maturation * 86400000;
  const maturedShare = raw.length
    ? raw.filter((r) => new Date(r.created_at).getTime() <= maturedBy).length / raw.length
    : 1;

  return {
    rows,
    totals: {
      leads: rows.reduce((n, r) => n + r.leads, 0),
      newLeads: rows.reduce((n, r) => n + r.newLeads, 0),
      purchased: rows.reduce((n, r) => n + r.purchased, 0),
      revenue: rows.reduce((n, r) => n + r.revenue, 0),
      revenueToDate: rows.reduce((n, r) => n + r.revenueToDate, 0),
    },
    window: {
      cohortStart: fixed ? fixed.from : `${maxAge} days ago`,
      cohortEnd: fixed ? fixed.to : `${minAge} days ago`,
      maturationDays: maturation,
      location,
      matured,
      maturesOn: matured ? null : maturesOn.toISOString().slice(0, 10),
      maturedShare,
    },
    unbackfilled,
    generatedAt: new Date().toISOString(),
  };
}
