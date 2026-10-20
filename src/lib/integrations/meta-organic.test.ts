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

describe('getIGCompetitorMetrics', () => {
    beforeEach(() => {
        vi.stubEnv('META_PAGE_ACCESS_TOKEN', 'tok');
        vi.stubEnv('META_IG_USER_ID', 'ig1');
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

    const stubDiscovery = (failing: (u: string) => boolean) => vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        const username = decodeURIComponent(url).match(/business_discovery\.username\(([^)]+)\)/)![1];
        if (failing(username)) return { ok: false, status: 400, json: async () => ({}) } as Response;
        return { ok: true, status: 200, json: async () => ({ business_discovery: { username, followers_count: 999, media_count: 10, media: { data: [] } } }) } as Response;
    }));

    it('leaves out a competitor that fails instead of showing stale hardcoded numbers', async () => {
        stubDiscovery(u => u === 'revolutiondecatur');
        const { getIGCompetitorMetrics } = await load();
        const res = await getIGCompetitorMetrics('decatur');
        expect(res.map(r => r.username)).toEqual(['seamlessrecoverymedspa']);
        expect(res.every(r => r.followersCount === 999)).toBe(true);
    });

    it('throws when every competitor fails', async () => {
        stubDiscovery(() => true);
        const { getIGCompetitorMetrics } = await load();
        await expect(getIGCompetitorMetrics('decatur')).rejects.toThrow();
    });

    it('throws when credentials are missing instead of returning hardcoded counts', async () => {
        vi.stubEnv('META_IG_USER_ID', '');
        stubDiscovery(() => false);
        const { getIGCompetitorMetrics } = await load();
        await expect(getIGCompetitorMetrics('decatur')).rejects.toThrow();
    });
});

// Meta rejects the whole insights request (error #100) when any metric in the
// list isn't valid; `plays` was removed on 2025-04-21. Valid names per the
// IG Media Insights reference.
const VALID_MEDIA_METRICS = new Set(['views', 'reach', 'likes', 'comments', 'shares', 'saved',
    'total_interactions', 'ig_reels_avg_watch_time', 'ig_reels_video_view_total_time']);

function stubMedia(insightsOk = true) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        const u = decodeURIComponent(url);
        const json = (status: number, body: unknown) => ({ ok: status === 200, status, json: async () => body }) as Response;
        if (u.includes('/media?')) {
            return json(200, { data: [
                { id: 'reel1', media_type: 'VIDEO', caption: '', media_url: '', permalink: '', timestamp: '2026-10-01T00:00:00+0000', like_count: 40, comments_count: 0 },
                { id: 'img1', media_type: 'IMAGE', caption: '', media_url: '', permalink: '', timestamp: '2026-10-02T00:00:00+0000', like_count: 20, comments_count: 0 },
            ] });
        }
        const names = u.match(/metric=([^&]+)/)![1].split(',');
        const bad = names.find(n => !VALID_MEDIA_METRICS.has(n));
        if (!insightsOk || bad) return json(400, { error: { code: 100, message: `metric[${bad}] must be one of the following values` } });
        const values: Record<string, number> = { views: 2000, reach: 1500, shares: 5, saved: 3, total_interactions: 48, ig_reels_avg_watch_time: 4200 };
        return json(200, { data: names.map(name => ({ name, values: [{ value: values[name] ?? 0 }] })) });
    }));
}

describe('getIGMedia insights', () => {
    beforeEach(() => {
        vi.stubEnv('META_PAGE_ACCESS_TOKEN', 'tok');
        vi.stubEnv('META_IG_USER_ID', 'ig1');
    });
    afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

    it('gets real views and reach for Reels, not just photos', async () => {
        stubMedia();
        const { getIGMedia } = await load();
        const [reel, img] = await getIGMedia(2);
        expect(reel).toMatchObject({ views: 2000, reach: 1500, avgWatchTime: 4200 });
        expect(img).toMatchObject({ views: 2000, reach: 1500 });
    });

    it('logs a failed insights call and leaves metrics unset instead of hiding it', async () => {
        stubMedia(false);
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { getIGMedia } = await load();
        const [reel] = await getIGMedia(2);
        expect(reel.views).toBeUndefined();
        expect(reel.reach).toBeUndefined();
        expect(error).toHaveBeenCalledWith(expect.stringContaining('reel1'), expect.stringContaining('400'));
    });
});
