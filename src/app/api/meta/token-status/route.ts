/**
 * Meta Token Status
 *
 * Queries Meta Graph API's debug_token to get live expiry info for
 * META_PAGE_ACCESS_TOKEN and META_ADS_ACCESS_TOKEN. Used by UI banners
 * to warn before a token expires (e.g., the ads token expires May 25, 2026).
 *
 * Returns `expiresAt: null` for tokens that never expire (page tokens).
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0';

interface TokenStatus {
    configured: boolean;
    valid: boolean;
    expiresAt: number | null;
    daysRemaining: number | null;
    error?: string;
}

async function checkToken(token: string | undefined): Promise<TokenStatus> {
    if (!token) return { configured: false, valid: false, expiresAt: null, daysRemaining: null };

    try {
        const res = await fetch(
            `${GRAPH_API_BASE}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`,
        );
        const data = await res.json();
        if (data.error) {
            return { configured: true, valid: false, expiresAt: null, daysRemaining: null, error: data.error.message };
        }

        const info = data.data;
        if (!info) {
            return { configured: true, valid: false, expiresAt: null, daysRemaining: null, error: 'Unexpected debug_token response' };
        }

        // expires_at = 0 means never expires (page tokens, system user tokens)
        const expiresAt: number | null = info.expires_at && info.expires_at > 0 ? info.expires_at : null;
        const daysRemaining = expiresAt ? Math.floor((expiresAt * 1000 - Date.now()) / 86_400_000) : null;

        return {
            configured: true,
            valid: !!info.is_valid,
            expiresAt,
            daysRemaining,
        };
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Network error';
        return { configured: true, valid: false, expiresAt: null, daysRemaining: null, error: msg };
    }
}

export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const [pageToken, adsToken] = await Promise.all([
        checkToken(process.env.META_PAGE_ACCESS_TOKEN?.trim()),
        checkToken(process.env.META_ADS_ACCESS_TOKEN?.trim()),
    ]);

    return NextResponse.json({ pageToken, adsToken });
}
