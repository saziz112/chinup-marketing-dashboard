import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
    sql: vi.fn(),
    config: { apify: true, youtube: false, anthropic: true },
    scrapeIg: vi.fn(),
    scrapeTt: vi.fn(),
}));
vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { email: 'x@y.com' } }) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/db/sql', () => ({ sql: h.sql }));
vi.mock('@/lib/db', () => ({ ensureContentResearchTables: async () => {} }));
vi.mock('@/lib/content-research/scrape', () => ({
    researchConfig: () => h.config,
    isPlatformConfigured: (p: string) => (p === 'youtube' ? h.config.youtube : h.config.apify),
    scrapeInstagramReels: h.scrapeIg,
    scrapeTikTokProfiles: h.scrapeTt,
    fetchYouTubeShorts: vi.fn(),
}));

const text = (c: unknown[]) => (c[0] as TemplateStringsArray).join('?');
const calls = (needle: string) => h.sql.mock.calls.filter(c => text(c).includes(needle));

function route(responses: { cooldown?: unknown[]; accounts?: unknown[] }) {
    h.sql.mockImplementation(async (strings: TemplateStringsArray) => {
        const q = strings.join('?');
        if (q.includes('FROM research_scrape_runs')) return { rows: responses.cooldown ?? [] };
        if (q.includes('FROM research_watchlist')) return { rows: responses.accounts ?? [] };
        if (q.includes('INSERT INTO research_scrape_runs')) return { rows: [{ id: 1 }] };
        if (q.includes('SELECT account_id, views')) return { rows: [{ account_id: 1, views: '1000' }, { account_id: 1, views: '3000' }] };
        return { rows: [] };
    });
}

async function post(body: unknown) {
    vi.resetModules();
    const { POST } = await import('./route');
    return POST(new NextRequest('http://x/api/research/outliers/refresh', { method: 'POST', body: JSON.stringify(body) }));
}

const igAccount = { id: 1, platform: 'instagram', handle: 'exampleinjector', lastScrapedAt: null, active: true };

describe('POST /api/research/outliers/refresh', () => {
    beforeEach(() => {
        h.config = { apify: true, youtube: false, anthropic: true };
        h.sql.mockReset();
        h.scrapeIg.mockReset();
        h.scrapeTt.mockReset();
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => vi.restoreAllMocks());

    it('says not configured and touches nothing when no keys are set', async () => {
        h.config = { apify: false, youtube: false, anthropic: false };
        route({});
        const res = await post({ confirm: true });
        expect(res.status).toBe(409);
        expect(h.sql).not.toHaveBeenCalled();
    });

    it('refuses a second run inside the cooldown', async () => {
        route({ cooldown: [{ started_at: new Date().toISOString() }], accounts: [igAccount] });
        const res = await post({ confirm: true });
        expect(res.status).toBe(429);
        expect(h.scrapeIg).not.toHaveBeenCalled();
    });

    it('returns the plan and cost without scraping unless confirmed', async () => {
        route({ accounts: [igAccount] });
        const res = await post({});
        const json = await res.json();
        expect(json.ran).toBe(false);
        expect(json.plan.accounts).toBe(1);
        expect(json.plan.estCostUsd).toBeGreaterThan(0);
        expect(h.scrapeIg).not.toHaveBeenCalled();
    });

    it('scrapes once per platform, stores videos and updates the account median', async () => {
        route({ accounts: [igAccount] });
        h.scrapeIg.mockResolvedValue({
            videos: [{ externalId: 'A1', accountHandle: 'exampleinjector', url: 'u', caption: '', views: 3000, likes: 1, comments: 1, shares: null, durationSec: 10, postedAt: null, thumbnailUrl: null, transcript: null }],
            errors: [],
        });
        const res = await post({ confirm: true });
        const json = await res.json();
        expect(json.ran).toBe(true);
        expect(h.scrapeIg).toHaveBeenCalledTimes(1);
        expect(h.scrapeIg.mock.calls[0][0]).toEqual(['exampleinjector']);
        expect(h.scrapeTt).not.toHaveBeenCalled();
        expect(calls('INSERT INTO research_videos')).toHaveLength(1);
        const update = calls('UPDATE research_watchlist')[0];
        expect(update[1]).toBe(2000); // median of 1000 and 3000
    });
});
