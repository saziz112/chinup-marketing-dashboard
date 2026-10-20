import { describe, it, expect } from 'vitest';
import { mapLimit } from './concurrency';

const tick = (n: number) => new Promise(r => setTimeout(r, n));

describe('mapLimit', () => {
    it('keeps input order even when later items finish first', async () => {
        const out = await mapLimit([30, 20, 10, 0], 4, async (ms, i) => { await tick(ms); return i; });
        expect(out).toEqual([0, 1, 2, 3]);
    });

    it('never runs more than `limit` calls at once', async () => {
        let inFlight = 0, peak = 0;
        await mapLimit(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
            peak = Math.max(peak, ++inFlight);
            await tick(2);
            inFlight--;
        });
        expect(peak).toBe(3);
    });

    it('rejects when any call fails', async () => {
        await expect(mapLimit([1, 2], 2, async n => { if (n === 2) throw new Error('boom'); return n; })).rejects.toThrow('boom');
    });

    it('handles an empty list', async () => {
        expect(await mapLimit([], 3, async x => x)).toEqual([]);
    });
});
