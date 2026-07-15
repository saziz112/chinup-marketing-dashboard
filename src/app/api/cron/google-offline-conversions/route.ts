/**
 * Vercel Cron: Upload MindBody sales to Google Ads as Offline Conversions
 *
 * Runs daily (configured in vercel.json). For each MindBody sale in the
 * window that maps to a captured gclid (via gclid_captures by email),
 * POST to Google Ads conversionUploads:uploadClickConversions.
 *
 * Idempotent: every successful upload is recorded in google_offline_uploads
 * keyed by (sale_id, conversion_action_id). Subsequent runs skip these.
 *
 * Required env vars:
 *  - GOOGLE_ADS_OFFLINE_CONVERSION_ACTION_ID  (from Phase 1 Google Ads UI step)
 *  - GOOGLE_ADS_CUSTOMER_ID, GOOGLE_ADS_LOGIN_CUSTOMER_ID, GOOGLE_ADS_DEVELOPER_TOKEN,
 *    GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN
 *  - CRON_SECRET (optional, but recommended)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sql } from '@/lib/db/sql';

export const maxDuration = 60;

interface SaleRow {
    sale_id: string; // TEXT since the Zenoti cutover — numeric for MindBody rows, GUID for Zenoti
    sale_date: string;
    total_amount: string;
    email: string;
    gclid: string;
}

async function getAccessToken(): Promise<string> {
    const params = new URLSearchParams({
        client_id: process.env.GOOGLE_ADS_CLIENT_ID!,
        client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET!,
        refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN!,
        grant_type: 'refresh_token',
    });
    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        cache: 'no-store',
    });
    if (!res.ok) throw new Error(`token exchange failed: ${await res.text()}`);
    return (await res.json()).access_token as string;
}

interface UploadConversion {
    gclid: string;
    conversionAction: string;
    conversionDateTime: string;
    conversionValue: number;
    currencyCode: string;
    orderId: string;
}

interface UploadResponse {
    results?: Array<{ gclid?: string; conversionAction?: string }>;
    partialFailureError?: { code: number; message: string; details?: unknown };
    error?: { message: string };
}

async function uploadConversions(
    accessToken: string,
    customerId: string,
    loginCustomerId: string,
    conversions: UploadConversion[],
): Promise<UploadResponse> {
    const url = `https://googleads.googleapis.com/v23/customers/${customerId}:uploadClickConversions`;
    const body = {
        conversions,
        partialFailure: true,
        validateOnly: false,
    };
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
            'login-customer-id': loginCustomerId,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        cache: 'no-store',
    });
    const text = await res.text();
    if (!res.ok) {
        try { return JSON.parse(text); } catch { throw new Error(`Google Ads upload failed: ${text}`); }
    }
    try { return JSON.parse(text); } catch { return {}; }
}

export async function GET(req: NextRequest) {
    // Auth: either cron-secret header or admin session
    const authHeader = req.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
        if (authHeader !== `Bearer ${cronSecret}`) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
    } else {
        const session = await getServerSession(authOptions);
        const user = session?.user as Record<string, unknown> | undefined;
        if (!user || user.isAdmin !== true) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
    }

    const actionId = process.env.GOOGLE_ADS_OFFLINE_CONVERSION_ACTION_ID;
    const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
    const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
    if (!actionId || !customerId || !loginCustomerId) {
        // Parked (2026-07-15): offline-conversions pipeline was never provisioned
        // (gclid_captures / google_offline_uploads tables never created, action id unset).
        // To revive: create the conversion action in Google Ads, run db init, set the env
        // vars, and re-add the daily cron in vercel.json. Return 200 so it stays quiet.
        return NextResponse.json({ ok: true, parked: true, reason: 'offline-conversions not provisioned' });
    }
    const conversionAction = `customers/${customerId}/conversionActions/${actionId}`;

    // Find MindBody sales in the last 14 days that have a matching gclid and
    // haven't been uploaded yet for this conversion action.
    const candidates = await sql<SaleRow>`
        SELECT
            s.sale_id,
            s.sale_date::text AS sale_date,
            s.total_amount::text AS total_amount,
            LOWER(TRIM(c.email)) AS email,
            g.gclid AS gclid
        FROM mb_sales_history s
        JOIN mb_clients_cache c ON c.client_id = s.client_id
        JOIN gclid_captures g ON g.email = LOWER(TRIM(c.email))
        LEFT JOIN google_offline_uploads u
            ON u.sale_id = s.sale_id::text AND u.conversion_action_id = ${actionId}
        WHERE s.sale_date >= CURRENT_DATE - INTERVAL '14 days'
          AND s.total_amount > 0
          AND c.email IS NOT NULL AND c.email <> ''
          AND u.sale_id IS NULL
        ORDER BY s.sale_date ASC
        LIMIT 500
    `;

    if (candidates.rows.length === 0) {
        return NextResponse.json({ ok: true, uploaded: 0, message: 'no pending sales' });
    }

    // Build conversion payloads. Conversion datetime must be RFC 3339 with TZ.
    // sale_date is just a date; use noon UTC as a stable wall-clock to avoid TZ edge cases.
    const conversions: UploadConversion[] = candidates.rows.map(r => ({
        gclid: r.gclid,
        conversionAction,
        conversionDateTime: `${r.sale_date} 12:00:00+00:00`,
        conversionValue: Number(r.total_amount),
        currencyCode: 'USD',
        orderId: `mb-sale-${r.sale_id}`,
    }));

    let accessToken: string;
    try {
        accessToken = await getAccessToken();
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'unknown';
        return NextResponse.json({ error: `token: ${msg}` }, { status: 500 });
    }

    // Chunk to 2000 per API limit; we set our query limit to 500 so one call is plenty
    let response: UploadResponse;
    try {
        response = await uploadConversions(accessToken, customerId, loginCustomerId, conversions);
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'unknown';
        console.error('[google-offline-conversions] upload error:', msg);
        return NextResponse.json({ error: msg }, { status: 500 });
    }

    // Record successes. Google returns one result per conversion (or null if it failed
    // when partialFailure is true). We match back by index.
    const results = response.results || [];
    const partialError = response.partialFailureError?.message || null;

    let inserted = 0;
    for (let i = 0; i < candidates.rows.length; i++) {
        const row = candidates.rows[i];
        const result = results[i];
        const ok = !!(result && result.gclid);
        const errMsg = ok ? null : (partialError || 'no result returned');

        await sql`
            INSERT INTO google_offline_uploads
                (sale_id, conversion_action_id, gclid, value, currency_code, conversion_datetime, uploaded_at, response_status, response_error)
            VALUES (${String(row.sale_id)}, ${actionId}, ${row.gclid}, ${Number(row.total_amount)}, 'USD',
                    ${`${row.sale_date} 12:00:00+00:00`}, NOW(),
                    ${ok ? 'success' : 'failed'}, ${errMsg})
            ON CONFLICT (sale_id, conversion_action_id) DO NOTHING
        `;
        if (ok) inserted++;
    }

    return NextResponse.json({
        ok: true,
        candidates: candidates.rows.length,
        uploaded: inserted,
        failed: candidates.rows.length - inserted,
        partialError,
    });
}
