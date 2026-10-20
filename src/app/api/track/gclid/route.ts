/**
 * Public gclid capture endpoint.
 *
 * Called by a GTM tag on form-submit on the chinupaesthetics.com landing pages.
 * Body: { email, gclid, wbraid?, gbraid?, landing_url? }
 *
 * Stores the gclid keyed by email so the daily offline-conversions cron can
 * later join it to paid Zenoti visits and upload them to Google Ads. Capture runs
 * whether or not the upload side is configured, so clicks aren't lost while it's off.
 *
 * The GTM tag should send the beacon as text/plain: Chrome refuses a cross-origin
 * sendBeacon with an application/json Blob, and the tag's try/catch hides that.
 *
 * Public on purpose — gclid + email are non-sensitive submission data and the
 * call has to originate from the browser without auth. Use CORS to allow
 * chinupaesthetics.com origins; reject everything else.
 */

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db/sql';

const ALLOWED_ORIGINS = [
    'https://chinupaesthetics.com',
    'https://www.chinupaesthetics.com',
    'https://decatur-offers.chinupaesthetics.com',
    'https://kennesaw-offers.chinupaesthetics.com',
    'https://smyrna-offers.chinupaesthetics.com',
    'https://vinings-offers.chinupaesthetics.com',
];

function corsHeaders(origin: string | null): Record<string, string> {
    const allow = origin && ALLOWED_ORIGINS.some(o => origin === o || origin.endsWith('.chinupaesthetics.com'))
        ? origin
        : ALLOWED_ORIGINS[0];
    return {
        'Access-Control-Allow-Origin': allow,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
    };
}

export async function OPTIONS(req: NextRequest) {
    return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) });
}

export async function POST(req: NextRequest) {
    const origin = req.headers.get('origin');
    const headers = corsHeaders(origin);

    // Read the raw text once: beacons arrive as text/plain or application/json.
    let body: { email?: string; gclid?: string; wbraid?: string; gbraid?: string; landing_url?: string };
    try {
        body = JSON.parse(await req.text());
    } catch {
        return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400, headers });
    }

    const email = (body.email || '').toLowerCase().trim();
    const gclid = (body.gclid || '').trim();

    if (!email || !gclid) {
        return NextResponse.json({ ok: false, error: 'email and gclid required' }, { status: 400, headers });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return NextResponse.json({ ok: false, error: 'invalid email' }, { status: 400, headers });
    }
    if (gclid.length > 512) {
        return NextResponse.json({ ok: false, error: 'gclid too long' }, { status: 400, headers });
    }

    const wbraid = body.wbraid ? body.wbraid.trim().slice(0, 512) : null;
    const gbraid = body.gbraid ? body.gbraid.trim().slice(0, 512) : null;
    const landingUrl = body.landing_url ? body.landing_url.trim().slice(0, 2000) : null;

    try {
        await sql`
            INSERT INTO gclid_captures (email, gclid, wbraid, gbraid, landing_url, captured_at, updated_at)
            VALUES (${email}, ${gclid}, ${wbraid}, ${gbraid}, ${landingUrl}, NOW(), NOW())
            ON CONFLICT (email) DO UPDATE SET
                -- captured_at stands in for the click time (90-day window, conversion
                -- must follow the click), so a new gclid restarts it.
                captured_at = CASE WHEN gclid_captures.gclid IS DISTINCT FROM EXCLUDED.gclid THEN NOW() ELSE gclid_captures.captured_at END,
                gclid = EXCLUDED.gclid,
                wbraid = COALESCE(EXCLUDED.wbraid, gclid_captures.wbraid),
                gbraid = COALESCE(EXCLUDED.gbraid, gclid_captures.gbraid),
                landing_url = COALESCE(EXCLUDED.landing_url, gclid_captures.landing_url),
                updated_at = NOW()
        `;

        // Best-effort: also copy gclid onto ghl_contacts_map if the contact already exists
        await sql`
            UPDATE ghl_contacts_map
            SET gclid = ${gclid}, gclid_captured_at = NOW()
            WHERE email = ${email} AND (gclid IS NULL OR gclid = '')
        `.catch(() => {});

        return NextResponse.json({ ok: true }, { headers });
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'unknown';
        console.error('[track/gclid] db error:', msg);
        return NextResponse.json({ ok: false, error: 'db error' }, { status: 500, headers });
    }
}
