import { describe, it, expect } from 'vitest';
import { planRefresh, estimateCost, COST_PER_ITEM_USD } from './plan';
import { SEED_WATCHLIST } from './seed-watchlist';
import { dedupeAccounts, accountKey } from './watchlist';

const now = new Date('2026-10-19T12:00:00Z');
const acct = (id: number, platform: 'instagram' | 'tiktok' | 'youtube', lastScrapedAt: string | null, active = true) =>
    ({ id, platform, handle: `h${id}`, lastScrapedAt, active });

describe('planRefresh', () => {
    it('picks only active accounts not scraped in the last 7 days, never-scraped first', () => {
        const plan = planRefresh([
            acct(1, 'instagram', '2026-10-18T00:00:00Z'),
            acct(2, 'instagram', '2026-10-01T00:00:00Z'),
            acct(3, 'instagram', null),
            acct(4, 'tiktok', null, false),
        ], now);
        expect(plan.accounts.map(a => a.id)).toEqual([3, 2]);
    });

    it('caps accounts per run', () => {
        const many = Array.from({ length: 30 }, (_, i) => acct(i + 1, 'tiktok', null));
        expect(planRefresh(many, now, { maxAccounts: 20 }).accounts).toHaveLength(20);
    });

    it('estimates paid items only (YouTube uses the free Data API)', () => {
        const plan = planRefresh([acct(1, 'instagram', null), acct(2, 'tiktok', null), acct(3, 'youtube', null)], now, { videosPerAccount: 20 });
        expect(plan.estCostUsd).toBeCloseTo(20 * COST_PER_ITEM_USD.instagram + 20 * COST_PER_ITEM_USD.tiktok + 0.002, 3);
    });
});

describe('estimateCost', () => {
    it('adds a start fee per paid platform run', () => {
        expect(estimateCost({ instagram: 0, tiktok: 0, youtube: 50 })).toBe(0);
        expect(estimateCost({ instagram: 100, tiktok: 0, youtube: 0 })).toBeCloseTo(0.261, 3);
    });
});

describe('SEED_WATCHLIST', () => {
    it('is 30-80 unique, parseable accounts across all three platforms', () => {
        const deduped = dedupeAccounts(SEED_WATCHLIST);
        expect(deduped).toHaveLength(SEED_WATCHLIST.length);
        expect(deduped.length).toBeGreaterThanOrEqual(30);
        expect(deduped.length).toBeLessThanOrEqual(80);
        expect(new Set(deduped.map(a => a.platform))).toEqual(new Set(['instagram', 'tiktok', 'youtube']));
    });

    it('includes the Atlanta competitors already tracked for Instagram', () => {
        const keys = new Set(SEED_WATCHLIST.map(a => accountKey(a.platform, a.handle)));
        for (const h of ['pureblissmedspa', 'skinsocialspa', 'radiancemedspaatl', 'revolutiondecatur', 'vivamedspaatl', 'spalapazatl']) {
            expect(keys.has(accountKey('instagram', h))).toBe(true);
        }
    });
});
