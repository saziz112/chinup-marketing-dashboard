/** Shared in-memory cache with TTL and optional max size (LRU eviction) */

export function createMemCache<T>(ttlMs: number, maxSize?: number) {
    const cache = new Map<string, { data: T; timestamp: number }>();

    return {
        get(key: string): T | null {
            const entry = cache.get(key);
            if (!entry) return null;
            if (Date.now() - entry.timestamp > ttlMs) {
                cache.delete(key);
                return null;
            }
            return entry.data;
        },

        set(key: string, data: T): void {
            if (maxSize && cache.size >= maxSize) {
                // Evict oldest entry
                const oldest = cache.keys().next().value;
                if (oldest !== undefined) cache.delete(oldest);
            }
            cache.set(key, { data, timestamp: Date.now() });
        },

        has(key: string): boolean {
            return this.get(key) !== null;
        },

        delete(key: string): void {
            cache.delete(key);
        },

        clear(): void {
            cache.clear();
        },

        get size(): number {
            return cache.size;
        },
    };
}
