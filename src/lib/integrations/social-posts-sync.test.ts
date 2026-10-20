import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ queries: [] as Array<{ text: string; values: unknown[] }> }));
vi.mock('@/lib/db/sql', () => ({
    sql: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        h.queries.push({ text: strings.join('?'), values });
        return { rows: [], rowCount: 0, command: '' };
    },
}));
vi.mock('@/lib/api-usage-tracker', () => ({ trackCall: () => {} }));

import { incrementalSocialSync } from './social-posts-sync';

// Meta rejects the whole insights request when any metric is invalid; `plays`
// was removed from media insights on 2025-04-21.
const VALID_MEDIA_METRICS = new Set(['views', 'reach', 'likes', 'comments', 'shares', 'saved', 'total_interactions']);

function stubGraph(insightsOk = true) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        const u = decodeURIComponent(url);
        const json = (status: number, body: unknown) => ({ ok: status === 200, status, json: async () => body }) as Response;
        if (u.includes('/media?')) {
            return json(200, { data: [{ id: 'reel1', media_type: 'VIDEO', caption: '', media_url: '', permalink: '', timestamp: '2026-10-01T00:00:00+0000', like_count: 40, comments_count: 0 }] });
        }
        const names = u.match(/metric=([^&]+)/)![1].split(',');
        const bad = names.find(n => !VALID_MEDIA_METRICS.has(n));
        if (!insightsOk || bad) return json(400, { error: { code: 100, message: `metric[${bad}] must be one of the following values` } });
        const values: Record<string, number> = { views: 2000, reach: 1500, shares: 5, saved: 3, total_interactions: 48 };
        return json(200, { data: names.map(name => ({ name, values: [{ value: values[name] ?? 0 }] })) });
    }));
}

// INSERT params: id, type, ts, caption, permalink, media_url, likes, comments, shares, saves, views, reach, impressions, engagement_rate
const upsert = () => h.queries.find(q => q.text.includes('INSERT INTO social_posts'))!;

describe('incrementalSocialSync', () => {
    beforeEach(() => {
        h.queries = [];
        vi.stubEnv('META_PAGE_ACCESS_TOKEN', 'tok');
        vi.stubEnv('META_IG_USER_ID', 'ig1');
    });
    afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

    it('stores real views and reach for Reels', async () => {
        stubGraph();
        await incrementalSocialSync();
        const v = upsert().values;
        expect(v.slice(8, 12)).toEqual([5, 3, 2000, 1500]);
        expect(v[13]).toBeCloseTo(48 / 2000);
    });

    it('stores NULL, not 0, when insights fail, keeps earlier values, and logs the error', async () => {
        stubGraph(false);
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        await incrementalSocialSync();
        const q = upsert();
        expect(q.values.slice(8, 14)).toEqual([null, null, null, null, null, null]);
        expect(q.text).toContain('views = COALESCE(EXCLUDED.views, social_posts.views)');
        expect(error).toHaveBeenCalledWith(expect.stringContaining('reel1'), expect.stringContaining('400'));
    });
});
