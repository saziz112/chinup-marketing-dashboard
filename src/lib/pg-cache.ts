/**
 * Two-tier cache: in-memory Map (30 min) → Postgres (3-day TTL) → API fetch
 * Survives Vercel cold starts via Postgres fallback.
 */

import { sql } from '@vercel/postgres';

/* ── In-Memory Tier ──────────────────────────────────────── */

const memCache = new Map<string, { data: unknown; expiresAt: number }>();
const MEM_TTL_MS = 30 * 60 * 1000; // 30 minutes

/* ── Public API ──────────────────────────────────────────── */

/**
 * Get cached data. Checks memory first, then Postgres.
 * Returns null if both miss.
 */
export async function pgCacheGet<T>(key: string): Promise<T | null> {
    // Tier 1: in-memory
    const mem = memCache.get(key);
    if (mem && mem.expiresAt > Date.now()) {
        return mem.data as T;
    }
    if (mem) memCache.delete(key);

    // Tier 2: Postgres
    try {
        const result = await sql`
            SELECT cache_data FROM sms_data_cache
            WHERE cache_key = ${key} AND expires_at > NOW()
        `;
        if (result.rows.length > 0) {
            const data = result.rows[0].cache_data as T;
            // Promote to memory
            memCache.set(key, { data, expiresAt: Date.now() + MEM_TTL_MS });
            return data;
        }
    } catch {
        // Table may not exist yet — silently fall through
    }

    return null;
}

/**
 * Set cache in both memory and Postgres.
 * @param ttlDays — Postgres TTL in days (default 3)
 */
export async function pgCacheSet(key: string, data: unknown, ttlDays = 3): Promise<void> {
    // Tier 1: memory
    memCache.set(key, { data, expiresAt: Date.now() + MEM_TTL_MS });

    // Tier 2: Postgres (upsert)
    try {
        await sql`
            INSERT INTO sms_data_cache (cache_key, cache_data, expires_at)
            VALUES (${key}, ${JSON.stringify(data)}::jsonb, NOW() + ${`${ttlDays} days`}::interval)
            ON CONFLICT (cache_key) DO UPDATE SET
                cache_data = EXCLUDED.cache_data,
                expires_at = EXCLUDED.expires_at,
                created_at = CURRENT_TIMESTAMP
        `;
    } catch {
        // Silently ignore if table doesn't exist yet
    }
}

/**
 * Invalidate a specific cache key from both tiers.
 */
export async function pgCacheInvalidate(key: string): Promise<void> {
    memCache.delete(key);
    try {
        await sql`DELETE FROM sms_data_cache WHERE cache_key = ${key}`;
    } catch {
        // ignore
    }
}

/**
 * Invalidate all keys matching a prefix (e.g. 'cancelled_' clears all locations).
 */
export async function pgCacheInvalidatePrefix(prefix: string): Promise<void> {
    // Clear matching memory entries
    for (const k of memCache.keys()) {
        if (k.startsWith(prefix)) memCache.delete(k);
    }
    try {
        await sql`DELETE FROM sms_data_cache WHERE cache_key LIKE ${prefix + '%'}`;
    } catch {
        // ignore
    }
}

/**
 * Purge expired entries from Postgres. Call periodically or on init.
 */
export async function pgCachePurgeExpired(): Promise<number> {
    try {
        const result = await sql`
            DELETE FROM sms_data_cache WHERE expires_at < NOW()
        `;
        return result.rowCount || 0;
    } catch {
        return 0;
    }
}
