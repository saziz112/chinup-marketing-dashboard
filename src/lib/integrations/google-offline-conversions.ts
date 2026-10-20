/**
 * Google Ads offline click conversions: paid Zenoti visits → uploadClickConversions.
 *
 * Path: landing-page form → /api/track/gclid stores (email, gclid, captured_at) in
 * gclid_captures → Zenoti sync fills mb_sales_history / mb_clients_cache → this job
 * joins them by email and uploads one conversion per paid visit-day.
 *
 * Event: a PAID visit (Zenoti Closed invoice lines for one guest on one day, summed;
 * $0 package-redemption days are skipped). Value = collected dollars that day.
 *
 * Rules (Google Ads API v23 ClickConversion, verified against developers.google.com
 * 2026-10-19):
 *  - conversion_date_time is `yyyy-mm-dd HH:mm:ss±HH:mm` and must be after the click.
 *    Zenoti only gives a sale DATE (center-local), so we use 23:59:59 America/New_York
 *    on that date, which is after any same-day click. Today's (unfinished) day waits.
 *  - The click must be inside the action's 90-day click-through window; captured_at
 *    (form submit) stands in for click time, with a one-day buffer.
 *  - order_id is a stable visit key, so Google also dedupes a repeat upload.
 *
 * Idempotency: google_offline_uploads keyed by (visit key, action id). success,
 * already_uploaded and failed (permanent) are never re-sent; retry rows are. A request
 * that fails as a whole records nothing, so every visit is retried next run.
 */

import { sql } from '@/lib/db/sql';

export const GOOGLE_ADS_API_VERSION = 'v23';
export const CLINIC_TZ = 'America/New_York';
const CLICK_WINDOW_DAYS = 90;
const CLICK_BUFFER_DAYS = 1; // captured_at is the form submit, a little after the click
const LOOKBACK_DAYS = 30;    // how far back to (re)consider visits each run
const MAX_PER_REQUEST = 2000; // API limit per uploadClickConversions request
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const REQUIRED_ENV = [
    'GOOGLE_ADS_OFFLINE_CONVERSION_ACTION_ID',
    'GOOGLE_ADS_CUSTOMER_ID',
    'GOOGLE_ADS_LOGIN_CUSTOMER_ID',
    'GOOGLE_ADS_DEVELOPER_TOKEN',
    'GOOGLE_ADS_CLIENT_ID',
    'GOOGLE_ADS_CLIENT_SECRET',
    'GOOGLE_ADS_REFRESH_TOKEN',
] as const;

type Env = Record<string, string | undefined>;

export interface OfflineConfig {
    actionId: string;
    customerId: string;
    loginCustomerId: string;
    conversionAction: string;
    developerToken: string;
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
    const customerId = env.GOOGLE_ADS_CUSTOMER_ID!.replace(/-/g, '').trim();
    return {
        ok: true,
        config: {
            actionId,
            customerId,
            loginCustomerId: env.GOOGLE_ADS_LOGIN_CUSTOMER_ID!.replace(/-/g, '').trim(),
            conversionAction: `customers/${customerId}/conversionActions/${actionId}`,
            developerToken: env.GOOGLE_ADS_DEVELOPER_TOKEN!,
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

/** 23:59:59 clinic time on `ymd`, as the API string and the instant it denotes. */
export function endOfDayConversionTime(ymd: string): { text: string; instant: Date } {
    const [y, m, d] = ymd.split('-').map(Number);
    const wall = Date.UTC(y, m - 1, d, 23, 59, 59);
    const offsetMin = Math.round((clinicParts(new Date(wall)).wallUtcMs - wall) / 60_000);
    const instant = new Date(wall - offsetMin * 60_000);
    const abs = Math.abs(offsetMin);
    const sign = offsetMin < 0 ? '-' : '+';
    const off = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
    return { text: `${ymd} 23:59:59${off}`, instant };
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
    conversionDateTime: string;
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
        else planned.push({ visitKey: key, saleDate: r.sale_date, gclid: r.gclid, conversionDateTime: conv.text, value });
    }
    return { planned, skipped };
}

// ---------------------------------------------------------------------------
// Response classification
// ---------------------------------------------------------------------------

export interface UploadResponse {
    results?: Array<{ gclid?: string; conversionAction?: string }>;
    partialFailureError?: {
        code?: number;
        message?: string;
        details?: Array<{ errors?: Array<{
            errorCode?: Record<string, string>;
            message?: string;
            location?: { fieldPathElements?: Array<{ fieldName?: string; index?: number }> };
        }> }>;
    };
    error?: { code?: number; message?: string; status?: string };
}

export type RowStatus = 'success' | 'already_uploaded' | 'failed' | 'retry';

/** Google already holds this conversion; re-sending can't help. */
const ALREADY_UPLOADED = new Set(['CLICK_CONVERSION_ALREADY_EXISTS', 'ORDER_ID_ALREADY_IN_USE']);
/** Facts about the click/visit that won't change on retry. Anything else (TOO_RECENT_*,
 *  action misconfiguration the owner can fix, unknown) stays retryable. */
const PERMANENT = new Set([
    'EXPIRED_EVENT', 'CONVERSION_PRECEDES_EVENT', 'UNPARSEABLE_GCLID', 'EVENT_NOT_FOUND', 'CLICK_NOT_FOUND',
    'INVALID_CUSTOMER_FOR_CLICK', 'UNAUTHORIZED_CUSTOMER', 'CONVERSION_TRACKING_NOT_ENABLED_AT_IMPRESSION_TIME',
    'ORDER_ID_CONTAINS_PII',
]);

export interface RowOutcome { status: RowStatus; code: string | null; error: string | null }

export function classifyResults(resp: UploadResponse, n: number): RowOutcome[] {
    const rowErrors = new Map<number, { code: string; message: string }>();
    for (const detail of resp.partialFailureError?.details ?? []) {
        for (const e of detail.errors ?? []) {
            const el = e.location?.fieldPathElements?.find(f => f.fieldName === 'conversions');
            if (!el) continue;
            const idx = el.index ?? 0;
            if (rowErrors.has(idx)) continue; // keep the first error per row
            const code = Object.values(e.errorCode ?? {})[0] ?? 'UNKNOWN';
            rowErrors.set(idx, { code, message: e.message ?? '' });
        }
    }

    const out: RowOutcome[] = [];
    for (let i = 0; i < n; i++) {
        const result = resp.results?.[i];
        if (result?.gclid) { out.push({ status: 'success', code: null, error: null }); continue; }
        const err = rowErrors.get(i);
        if (!err) {
            out.push({ status: 'retry', code: null, error: resp.partialFailureError?.message || 'no result returned' });
            continue;
        }
        const status: RowStatus = ALREADY_UPLOADED.has(err.code) ? 'already_uploaded'
            : PERMANENT.has(err.code) ? 'failed' : 'retry';
        out.push({ status, code: err.code, error: `${err.code}: ${err.message}` });
    }
    return out;
}

// ---------------------------------------------------------------------------
// Google Ads calls
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

async function uploadClickConversions(
    token: string, cfg: OfflineConfig, conversions: PlannedConversion[], validateOnly: boolean,
): Promise<{ ok: boolean; status: number; body: UploadResponse; raw: string }> {
    const res = await fetch(
        `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${cfg.customerId}:uploadClickConversions`,
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'developer-token': cfg.developerToken,
                'login-customer-id': cfg.loginCustomerId,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                conversions: conversions.map(c => ({
                    gclid: c.gclid,
                    conversionAction: cfg.conversionAction,
                    conversionDateTime: c.conversionDateTime,
                    conversionValue: c.value,
                    currencyCode: 'USD',
                    orderId: c.visitKey,
                })),
                partialFailure: true,
                validateOnly,
            }),
            cache: 'no-store',
        },
    );
    const raw = await res.text();
    let body: UploadResponse = {};
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
    uploaded?: number;
    alreadyUploaded?: number;
    failed?: number;
    retry?: number;
    skippedVisits?: Partial<Record<SkipReason, number>>;
    errors?: ({ visitKey: string } & RowOutcome)[];
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

    // One row per (guest, day) with a captured gclid, excluding visits already done
    // for this action. Retry rows come back.
    const since = new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS).toISOString().slice(0, 10);
    const candidates = await sql<VisitRow>`
        SELECT s.client_id::text AS client_id,
               s.sale_date::text AS sale_date,
               SUM(s.total_amount)::text AS value,
               g.gclid,
               g.captured_at
        FROM mb_sales_history s
        JOIN mb_clients_cache c ON c.client_id = s.client_id
        JOIN gclid_captures g ON g.email = LOWER(TRIM(c.email))
        WHERE s.sale_date >= ${since}
          AND c.email IS NOT NULL AND c.email <> ''
          AND NOT EXISTS (
              SELECT 1 FROM google_offline_uploads u
              WHERE u.sale_id = 'zenoti-visit-' || s.client_id::text || '-' || s.sale_date::text
                AND u.conversion_action_id = ${cfg.actionId}
                AND u.response_status IN ('success', 'already_uploaded', 'failed')
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
        ok: true, validateOnly, candidates: candidates.rows.length, planned: planned.length,
        uploaded: 0, alreadyUploaded: 0, failed: 0, retry: 0, skippedVisits,
    };
    if (planned.length === 0) return base;

    let upload: Awaited<ReturnType<typeof uploadClickConversions>>;
    try {
        upload = await uploadClickConversions(await getAccessToken(cfg), cfg, planned, validateOnly);
    } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        console.error('[google-offline-conversions] request failed:', error);
        return { ...base, ok: false, error };
    }
    if (!upload.ok) {
        // Whole request rejected (auth, quota, bad action). Record nothing: every visit retries.
        const error = `HTTP ${upload.status}: ${upload.body.error?.message ?? upload.raw.slice(0, 500)}`;
        console.error('[google-offline-conversions] upload rejected:', error);
        return { ...base, ok: false, error };
    }

    const outcomes = classifyResults(upload.body, planned.length);
    const errors = outcomes
        .map((o, i) => ({ visitKey: planned[i].visitKey, ...o }))
        .filter(o => o.status !== 'success');

    if (validateOnly) {
        // Nothing was imported (rows come back empty), so record nothing and report only
        // the rows Google named an error for.
        return { ...base, errors: errors.filter(e => e.code).slice(0, 50) };
    }

    const counts = { success: 0, already_uploaded: 0, failed: 0, retry: 0 };
    for (let i = 0; i < planned.length; i++) {
        const p = planned[i];
        const o = outcomes[i];
        counts[o.status]++;
        await sql`
            INSERT INTO google_offline_uploads
                (sale_id, conversion_action_id, gclid, value, currency_code, conversion_datetime, uploaded_at, response_status, response_error)
            VALUES (${p.visitKey}, ${cfg.actionId}, ${p.gclid}, ${p.value}, 'USD',
                    ${endOfDayConversionTime(p.saleDate).instant}, NOW(), ${o.status}, ${o.error})
            ON CONFLICT (sale_id, conversion_action_id) DO UPDATE SET
                gclid = EXCLUDED.gclid,
                value = EXCLUDED.value,
                conversion_datetime = EXCLUDED.conversion_datetime,
                uploaded_at = NOW(),
                response_status = EXCLUDED.response_status,
                response_error = EXCLUDED.response_error
        `;
    }
    if (counts.failed || counts.retry) {
        console.warn(`[google-offline-conversions] ${counts.failed} failed, ${counts.retry} will retry`, errors.slice(0, 5));
    }

    return {
        ...base,
        uploaded: counts.success,
        alreadyUploaded: counts.already_uploaded,
        failed: counts.failed,
        retry: counts.retry,
        errors: errors.slice(0, 50),
    };
}
