/**
 * The bonus dashboard's lapsed-patient call list owns those patients (Sam,
 * 2026-10-01). On Oct 1, 107 patients on that list had also been texted by a
 * campaign here in the last 60 days, mostly Lapsed VIP. Every campaign now
 * skips anyone on this month's call list, and the call list holds back anyone
 * texted here in the last 30 days (see /api/outreach-sync/recent-texts).
 *
 * Only phone hashes cross between the apps (hashPhone format), authenticated
 * with OUTREACH_SYNC_SECRET.
 */

const OUTREACH_URL = process.env.OUTREACH_DASHBOARD_URL ?? 'https://book.chinupaesthetics.com';
const TTL_MS = 5 * 60 * 1000;

let cache: { at: number; hashes: Set<string> } | null = null;

/** Throws when the list cannot be read: callers must not send blind. */
export async function getOutreachListHashes(): Promise<Set<string>> {
    if (cache && Date.now() - cache.at < TTL_MS) return cache.hashes;
    const secret = process.env.OUTREACH_SYNC_SECRET;
    if (!secret) throw new Error('OUTREACH_SYNC_SECRET is not set');
    const res = await fetch(`${OUTREACH_URL}/api/outreach/sync/list`, {
        headers: { authorization: `Bearer ${secret}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`outreach list returned ${res.status}`);
    const body = await res.json() as { hashes?: string[] };
    if (!Array.isArray(body.hashes)) throw new Error('outreach list returned no hashes');
    cache = { at: Date.now(), hashes: new Set(body.hashes) };
    return cache.hashes;
}

export function syncAuthorized(req: Request): boolean {
    const secret = process.env.OUTREACH_SYNC_SECRET;
    return !!secret && req.headers.get('authorization') === `Bearer ${secret}`;
}
