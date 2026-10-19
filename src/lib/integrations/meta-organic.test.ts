import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/api-usage-tracker', () => ({ trackCall: () => {} }));

// Three days of daily reach (100 each, heavily overlapping audience) and a
// deduplicated range total of 180 unique accounts.
function stubInsights() {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        let body: unknown;
        if (url.includes('metric_type=total_value')) {
            const names = decodeURIComponent(url).match(/metric=([^&]+)/)![1].split(',');
            body = { data: names.map(name => ({ name, total_value: { value: name === 'reach' ? 180 : name === 'total_interactions' ? 36 : 1 } })) };
        } else {
            body = { data: [{ name: 'reach', values: [1, 2, 3].map(d => ({ value: 100, end_time: `2026-10-0${d}T07:00:00+0000` })) },
                            { name: 'follower_count', values: [1, 2, 3].map(d => ({ value: 2, end_time: `2026-10-0${d}T07:00:00+0000` })) }] };
        }
        return { ok: true, status: 200, json: async () => body } as Response;
    }));
}

async function load() {
    vi.resetModules();
    return import('./meta-organic');
}

describe('Instagram reach', () => {
    beforeEach(() => {
        vi.stubEnv('META_PAGE_ACCESS_TOKEN', 'tok');
        vi.stubEnv('META_IG_USER_ID', 'ig1');
        stubInsights();
    });
    afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

    it('period totals report unique accounts reached, not the sum of daily reach', async () => {
        const { getIGPeriodTotals } = await load();
        const res = await getIGPeriodTotals('2026-10-01', '2026-10-03');
        expect(res.totalReach).toBe(180);
    });

    it('insights totals carry unique reach for the window', async () => {
        const { getIGInsights } = await load();
        const res = await getIGInsights('2026-10-01', '2026-10-03');
        expect(res.totals.reach).toBe(180);
        expect(res.daily.map(d => d.reach)).toEqual([100, 100, 100]);
    });
});
