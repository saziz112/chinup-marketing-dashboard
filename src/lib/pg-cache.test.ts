import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A fake sms_data_cache table shared by every "instance" (module reload).
const db = vi.hoisted(() => new Map<string, { data: unknown; expiresAt: number }>());
vi.mock('@/lib/db/sql', () => {
    const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const text = strings.join('?');
        if (text.includes('SELECT cache_data')) {
            const row = db.get(values[0] as string);
            return { rows: row && row.expiresAt > Date.now() ? [{ cache_data: row.data, expires_at: new Date(row.expiresAt) }] : [] };
        }
        if (text.includes('INSERT INTO sms_data_cache')) {
            const hours = parseFloat(String(values[2]));
            db.set(values[0] as string, { data: JSON.parse(JSON.stringify(values[1])), expiresAt: Date.now() + hours * 3600_000 });
            return { rows: [] };
        }
        return { rows: [] };
    };
    sql.json = (v: unknown) => v;
    return { sql };
});

async function freshInstance() {
    vi.resetModules();
    return import('./pg-cache');
}

describe('pgCached', () => {
    beforeEach(() => db.clear());
    afterEach(() => vi.useRealTimers());

    it('serves a second serverless instance from Postgres instead of reloading', async () => {
        const load = vi.fn(async () => ({ n: 1 }));
        const a = await freshInstance();
        expect(await a.pgCached('k', { ttlHours: 1 }, load)).toEqual({ n: 1 });
        const b = await freshInstance();
        expect(await b.pgCached('k', { ttlHours: 1 }, load)).toEqual({ n: 1 });
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('caches nothing when the loader throws', async () => {
        const { pgCached } = await freshInstance();
        await expect(pgCached('k', { ttlHours: 1 }, async () => { throw new Error('api down'); })).rejects.toThrow('api down');
        expect(db.has('k')).toBe(false);
    });

    it('does not hold a 15-minute entry in memory for 30 minutes', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-19T12:00:00Z'));
        const { pgCached } = await freshInstance();
        const load = vi.fn(async () => Date.now());
        await pgCached('k', { ttlHours: 0.25 }, load);
        vi.setSystemTime(new Date('2026-10-19T12:20:00Z'));
        await pgCached('k', { ttlHours: 0.25 }, load);
        expect(load).toHaveBeenCalledTimes(2);
    });
});
