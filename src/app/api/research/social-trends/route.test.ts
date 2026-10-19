import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({ sql: vi.fn() }));
vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { email: 'x@y.com' } }) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/db/sql', () => ({ sql: h.sql }));
vi.mock('@/lib/integrations/apify-tiktok', () => ({ isApifyConfigured: () => false, scrapeHashtag: vi.fn() }));

const cacheWrites = () => h.sql.mock.calls.filter(c => (c[0] as TemplateStringsArray).join('?').includes('INSERT INTO research_social_cache'));

async function get(source: string) {
    vi.resetModules();
    const { GET } = await import('./route');
    return GET(new NextRequest(`http://x/api/research/social-trends?source=${source}`));
}

describe('GET /api/research/social-trends', () => {
    beforeEach(() => {
        vi.stubEnv('META_PAGE_ACCESS_TOKEN', 'tok');
        vi.stubEnv('META_IG_USER_ID', 'ig1');
        h.sql.mockReset().mockResolvedValue({ rows: [] });
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

    it('does not cache an empty result when every hashtag lookup fails', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'expired token' } }) })));
        await get('instagram');
        expect(cacheWrites()).toHaveLength(0);
    });

    it('does not cache a not-configured result', async () => {
        vi.stubEnv('YOUTUBE_API_KEY', '');
        await get('youtube');
        expect(cacheWrites()).toHaveLength(0);
    });

    it('caches a result that has data', async () => {
        vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
            ok: true, status: 200,
            json: async () => url.includes('ig_hashtag_search') ? { data: [{ id: 'h1' }] } : { data: [{ id: 'p1', like_count: 3 }] },
        })));
        await get('instagram');
        expect(cacheWrites()).toHaveLength(1);
    });
});
