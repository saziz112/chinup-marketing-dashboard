/**
 * Instagram Publish Diagnostic
 *
 * Queries three things to diagnose IG publishing failures:
 * 1. /me?fields=permissions — what scopes our token actually has
 * 2. /{ig-user-id}/content_publishing_limit — how many posts remain in the 24h window
 * 3. /debug_token — token validity + expiry
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0';

export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const user = session.user as Record<string, unknown>;
    if (user.isAdmin !== true) {
        return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    }

    const token = process.env.META_PAGE_ACCESS_TOKEN?.trim();
    const igUserId = process.env.META_IG_USER_ID?.trim();
    if (!token || !igUserId) {
        return NextResponse.json({ error: 'META_PAGE_ACCESS_TOKEN or META_IG_USER_ID missing' }, { status: 500 });
    }

    const results: Record<string, unknown> = {};

    // 1. Permissions
    try {
        const r = await fetch(`${GRAPH_API_BASE}/me/permissions?access_token=${encodeURIComponent(token)}`);
        const data = await r.json();
        results.permissions = data.error
            ? { error: data.error }
            : data.data?.map((p: { permission: string; status: string }) => ({ permission: p.permission, status: p.status }));
    } catch (err) {
        results.permissions = { error: err instanceof Error ? err.message : 'fetch failed' };
    }

    // 2. IG content publishing limit (quota remaining in 24h window)
    try {
        const r = await fetch(
            `${GRAPH_API_BASE}/${igUserId}/content_publishing_limit?fields=quota_usage,config&access_token=${encodeURIComponent(token)}`,
        );
        const data = await r.json();
        results.contentPublishingLimit = data.error ? { error: data.error } : data.data;
    } catch (err) {
        results.contentPublishingLimit = { error: err instanceof Error ? err.message : 'fetch failed' };
    }

    // 3. Token debug (scopes, validity, expiry)
    try {
        const r = await fetch(
            `${GRAPH_API_BASE}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`,
        );
        const data = await r.json();
        results.tokenDebug = data.error ? { error: data.error } : data.data;
    } catch (err) {
        results.tokenDebug = { error: err instanceof Error ? err.message : 'fetch failed' };
    }

    // 4. IG user info (confirm the IG_USER_ID is still valid + which account it is)
    try {
        const r = await fetch(
            `${GRAPH_API_BASE}/${igUserId}?fields=id,username,name,account_type,media_count&access_token=${encodeURIComponent(token)}`,
        );
        const data = await r.json();
        results.igUser = data.error ? { error: data.error } : data;
    } catch (err) {
        results.igUser = { error: err instanceof Error ? err.message : 'fetch failed' };
    }

    return NextResponse.json(results);
}
