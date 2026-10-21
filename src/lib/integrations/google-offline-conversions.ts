/**
 * Google Ads offline click conversions: paid Zenoti visits → Data Manager events:ingest.
 *
 * Path: landing-page form → /api/track/gclid stores (email, gclid, captured_at) in
 * gclid_captures (or GHL records the gclid on the lead's attributionSource) → Zenoti sync fills mb_sales_history / mb_clients_cache → this job
 * joins them by email and uploads one conversion per paid visit-day.
 *
 * Event: a PAID visit (Zenoti Closed invoice lines for one guest on one day, summed;
 * $0 package-redemption days are skipped). Value = collected dollars that day.
 *
 * Why Data Manager: Google Ads uploadClickConversions rejects this customer with
 * CUSTOMER_NOT_ALLOWLISTED_FOR_THIS_FEATURE (new integrations must use Data Manager;
 * seen 2026-10-20). Data Manager needs the OAuth scope auth/datamanager on the refresh
 * token; no developer token.
 *
 * Rules (Data Manager v1 events:ingest, verified against developers.google.com 2026-10-20):
 *  - eventTimestamp is RFC 3339 with an offset and must be after the click.
 *    Zenoti only gives a sale DATE (center-local), so we use 23:59:59 America/New_York
 *    on that date, which is after any same-day click. Today's (unfinished) day waits.
 *  - The click must be inside the action's 90-day click-through window; captured_at
 *    (form submit) stands in for click time, with a one-day buffer.
 *  - transactionId is a stable visit key, so Google also dedupes a repeat upload.
 *  - A 200 only means the request was accepted. Per-event outcomes arrive later, as
 *    counts per reason, from requestStatus:retrieve with the stored request id.
 *
 * Idempotency: google_offline_uploads keyed by (visit key, action id). Accepted visits
 * are recorded as `sent` (request id in response_error) and never re-sent; so are the
 * legacy success, already_uploaded and failed rows. Old retry rows are re-sent. A request
 * that is rejected as a whole records nothing, so every visit is retried next run.
 */

import { sql } from '@/lib/db/sql';

const INGEST_URL = 'https://datamanager.googleapis.com/v1/events:ingest';
export const CLINIC_TZ = 'America/New_York';
const CLICK_WINDOW_DAYS = 90;
const CLICK_BUFFER_DAYS = 1; // captured_at is the form submit, a little after the click
const LOOKBACK_DAYS = CLICK_WINDOW_DAYS; // any older visit is past every click's window anyway
const MAX_PER_REQUEST = 2000; // API limit per events:ingest request
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const REQUIRED_ENV = [
    'GOOGLE_ADS_OFFLINE_CONVERSION_ACTION_ID',
    'GOOGLE_ADS_CUSTOMER_ID',
    'GOOGLE_ADS_LOGIN_CUSTOMER_ID',
    'GOOGLE_ADS_CLIENT_ID',
    'GOOGLE_ADS_CLIENT_SECRET',
    'GOOGLE_ADS_REFRESH_TOKEN',
] as const;

type Env = Record<string, string | undefined>;

export interface OfflineConfig {
    actionId: string;
    customerId: string;
    loginCustomerId: string;
    clientId: string;
    clientSecret: string;
    refreshToken: string;
}

export function readOfflineConfig(env: Env = process.env):
    { ok: true; config: OfflineConfig } | { ok: false; reason: string } {
    const missing = REQUIRED_ENV.filter(k => !env[k]?.trim());
    if (missing.length) return { ok: false, reason: `missing env: ${missing.join(', ')}` };

    const actionId = env.GOOGLE_ADS_OFFLINE_CONVERSION_ACTION_ID!.trim();
    if (!/^\d+$/.test(actionId)) {
        return { ok: false, reason: 'GOOGLE_ADS_OFFLINE_CONVERSION_ACTION_ID must be the numeric conversion action id (ctId)' };
    }
    return {
        ok: true,
        config: {
            actionId,
            customerId: env.GOOGLE_ADS_CUSTOMER_ID!.replace(/-/g, '').trim(),
            loginCustomerId: env.GOOGLE_ADS_LOGIN_CUSTOMER_ID!.replace(/-/g, '').trim(),
            clientId: env.GOOGLE_ADS_CLIENT_ID!,
            clientSecret: env.GOOGLE_ADS_CLIENT_SECRET!,
            refreshToken: env.GOOGLE_ADS_REFRESH_TOKEN!,
        },
    };
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/** Wall-clock parts of an instant in the clinic timezone. */
function clinicParts(d: Date) {
    const p = Object.fromEntries(
        new Intl.DateTimeFormat('en-US', {
            timeZone: CLINIC_TZ, hourCycle: 'h23',
            year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
        }).formatToParts(d).map(x => [x.type, x.value]),
    );
    return { ymd: `${p.year}-${p.month}-${p.day}`, wallUtcMs: Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) };
}

export function clinicDate(d: Date): string {
    return clinicParts(d).ymd;
}

/** 23:59:59 clinic time on `ymd`, as an RFC 3339 string and the instant it denotes. */
export function endOfDayConversionTime(ymd: string): { text: string; instant: Date } {
    const [y, m, d] = ymd.split('-').map(Number);
    const wall = Date.UTC(y, m - 1, d, 23, 59, 59);
    const offsetMin = Math.round((clinicParts(new Date(wall)).wallUtcMs - wall) / 60_000);
    const instant = new Date(wall - offsetMin * 60_000);
    const abs = Math.abs(offsetMin);
    const sign = offsetMin < 0 ? '-' : '+';
    const off = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
    return { text: `${ymd}T23:59:59${off}`, instant };
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

export interface VisitRow {
    client_id: string;
    sale_date: string;           // YYYY-MM-DD, center-local
    value: string | number;      // summed collected dollars for the day
    gclid: string;
    captured_at: Date | string;
}

export interface PlannedConversion {
    visitKey: string;
    saleDate: string;
    gclid: string;
    eventTimestamp: string;
    value: number;
}

export type SkipReason = 'no_value' | 'day_not_closed' | 'precedes_click' | 'click_expired';

export function visitKey(clientId: string, saleDate: string): string {
    return `zenoti-visit-${clientId}-${saleDate}`;
}

export function planConversions(rows: VisitRow[], now: Date):
    { planned: PlannedConversion[]; skipped: { visitKey: string; reason: SkipReason }[] } {
    const today = clinicDate(now);
    const planned: PlannedConversion[] = [];
    const skipped: { visitKey: string; reason: SkipReason }[] = [];

    for (const r of rows) {
        const key = visitKey(String(r.client_id), r.sale_date);
        const value = Math.round(Number(r.value) * 100) / 100;
        const captured = new Date(r.captured_at);
        const conv = endOfDayConversionTime(r.sale_date);

        let reason: SkipReason | null = null;
        if (!(value > 0)) reason = 'no_value';
        else if (r.sale_date >= today) reason = 'day_not_closed';
        else if (r.sale_date < clinicDate(captured)) reason = 'precedes_click';
        else if (conv.instant.getTime() - captured.getTime() > (CLICK_WINDOW_DAYS - CLICK_BUFFER_DAYS) * DAY_MS) reason = 'click_expired';

        if (reason) skipped.push({ visitKey: key, reason });
        else planned.push({ visitKey: key, saleDate: r.sale_date, gclid: r.gclid, eventTimestamp: conv.text, value });
    }
    return { planned, skipped };
}

// ---------------------------------------------------------------------------
// Google calls
// ---------------------------------------------------------------------------

async function getAccessToken(cfg: OfflineConfig): Promise<string> {
    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: cfg.clientId, client_secret: cfg.clientSecret,
            refresh_token: cfg.refreshToken, grant_type: 'refresh_token',
        }).toString(),
        cache: 'no-store',
    });
    if (!res.ok) throw new Error(`token exchange failed (${res.status}): ${await res.text()}`);
    return (await res.json()).access_token as string;
}

interface IngestResponse {
    requestId?: string;
    error?: { code?: number; message?: string; status?: string };
}

async function ingestEvents(
    token: string, cfg: OfflineConfig, conversions: PlannedConversion[], validateOnly: boolean,
): Promise<{ ok: boolean; status: number; body: IngestResponse; raw: string }> {
    const res = await fetch(INGEST_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            destinations: [{
                operatingAccount: { accountType: 'GOOGLE_ADS', accountId: cfg.customerId },
                loginAccount: { accountType: 'GOOGLE_ADS', accountId: cfg.loginCustomerId },
                productDestinationId: cfg.actionId,
            }],
            events: conversions.map(c => ({
                adIdentifiers: { gclid: c.gclid },
                conversionValue: c.value,
                currency: 'USD',
                eventTimestamp: c.eventTimestamp,
                transactionId: c.visitKey,
                eventSource: 'WEB',
            })),
            validateOnly,
        }),
        cache: 'no-store',
    });
    const raw = await res.text();
    let body: IngestResponse = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { /* non-JSON error page */ }
    return { ok: res.ok, status: res.status, body, raw };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

export interface RunResult {
    ok: boolean;
    skipped?: boolean;
    reason?: string;
    error?: string;
    validateOnly?: boolean;
    candidates?: number;
    planned?: number;
    sent?: number;
    requestId?: string;
    skippedVisits?: Partial<Record<SkipReason, number>>;
}

export async function runOfflineConversionUpload(opts: {
    env?: Env; now?: Date; validateOnly?: boolean;
} = {}): Promise<RunResult> {
    const now = opts.now ?? new Date();
    const validateOnly = opts.validateOnly ?? false;

    const cfgResult = readOfflineConfig(opts.env ?? process.env);
    if (!cfgResult.ok) {
        console.warn(`[google-offline-conversions] not running: ${cfgResult.reason}`);
        return { ok: false, skipped: true, reason: cfgResult.reason };
    }
    const cfg = cfgResult.config;

    // One row per (guest, day) with a captured gclid, excluding visits already sent or
    // done for this action. Legacy retry rows come back.
    const since = new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS).toISOString().slice(0, 10);
    const candidates = await sql<VisitRow>`
        SELECT s.client_id::text AS client_id,
               s.sale_date::text AS sale_date,
               SUM(s.total_amount)::text AS value,
               g.gclid,
               g.captured_at
        FROM mb_sales_history s
        JOIN mb_clients_cache c ON c.client_id = s.client_id
        JOIN (
            SELECT email, gclid, captured_at FROM gclid_captures
            UNION ALL
            -- GHL offer-page forms record the gclid themselves (first-touch
            -- attributionSource); the contact's created_at is the form submit.
            -- The website beacon wins when both exist.
            SELECT * FROM (
                SELECT DISTINCT ON (LOWER(TRIM(m.email)))
                       LOWER(TRIM(m.email)) AS email, m.attribution_source->>'gclid' AS gclid, m.created_at AS captured_at
                FROM ghl_contacts_map m
                WHERE m.attribution_source->>'gclid' <> '' AND m.email <> ''
                  AND NOT EXISTS (SELECT 1 FROM gclid_captures x WHERE x.email = LOWER(TRIM(m.email)))
                ORDER BY LOWER(TRIM(m.email)), m.created_at DESC
            ) ghl
        ) g ON g.email = LOWER(TRIM(c.email))
        WHERE s.sale_date >= ${since}
          AND c.email IS NOT NULL AND c.email <> ''
          AND NOT EXISTS (
              SELECT 1 FROM google_offline_uploads u
              WHERE u.sale_id = 'zenoti-visit-' || s.client_id::text || '-' || s.sale_date::text
                AND u.conversion_action_id = ${cfg.actionId}
                AND u.response_status IN ('sent', 'success', 'already_uploaded', 'failed')
          )
        GROUP BY s.client_id, s.sale_date, g.gclid, g.captured_at
        ORDER BY s.sale_date ASC
        LIMIT ${MAX_PER_REQUEST * 2}
    `;

    const { planned: allPlanned, skipped } = planConversions(candidates.rows, now);
    const planned = allPlanned.slice(0, MAX_PER_REQUEST);
    const skippedVisits: Partial<Record<SkipReason, number>> = {};
    for (const s of skipped) skippedVisits[s.reason] = (skippedVisits[s.reason] ?? 0) + 1;

    const base: RunResult = {
        ok: true, validateOnly, candidates: candidates.rows.length, planned: planned.length, sent: 0, skippedVisits,
    };
    if (planned.length === 0) return base;

    let upload: Awaited<ReturnType<typeof ingestEvents>>;
    try {
        upload = await ingestEvents(await getAccessToken(cfg), cfg, planned, validateOnly);
    } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        console.error('[google-offline-conversions] request failed:', error);
        return { ...base, ok: false, error };
    }
    if (!upload.ok) {
        // Whole request rejected (auth, scope, bad destination, bad field). Record nothing: every visit retries.
        const error = `HTTP ${upload.status}: ${upload.body.error?.message ?? upload.raw.slice(0, 500)}`;
        console.error('[google-offline-conversions] ingest rejected:', error);
        return { ...base, ok: false, error };
    }
    const requestId = upload.body.requestId;
    if (validateOnly) return { ...base, requestId };

    for (const p of planned) {
        await sql`
            INSERT INTO google_offline_uploads
                (sale_id, conversion_action_id, gclid, value, currency_code, conversion_datetime, uploaded_at, response_status, response_error)
            VALUES (${p.visitKey}, ${cfg.actionId}, ${p.gclid}, ${p.value}, 'USD',
                    ${endOfDayConversionTime(p.saleDate).instant}, NOW(), ${'sent'}, ${`requestId ${requestId ?? 'none'}`})
            ON CONFLICT (sale_id, conversion_action_id) DO UPDATE SET
                gclid = EXCLUDED.gclid,
                value = EXCLUDED.value,
                conversion_datetime = EXCLUDED.conversion_datetime,
                uploaded_at = NOW(),
                response_status = EXCLUDED.response_status,
                response_error = EXCLUDED.response_error
        `;
    }

    return { ...base, sent: planned.length, requestId };
}
