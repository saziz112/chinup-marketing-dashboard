import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ session: { user: { isAdmin: true } } as unknown }));
vi.mock('next-auth', () => ({ getServerSession: async () => h.session }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/integrations/meta-organic', () => ({ isMetaConfigured: () => true }));
vi.mock('@/lib/integrations/youtube', () => ({ isYouTubeConfigured: () => false }));
vi.mock('@/lib/integrations/meta-ads', () => ({ isMetaAdsConfigured: () => true }));
vi.mock('@/lib/integrations/google-ads', () => ({ isGoogleAdsConfigured: () => false }));
vi.mock('@/lib/integrations/search-console', () => ({ isGscConfigured: () => true }));

import { GET } from './route';

describe('GET /api/settings/connections', () => {
    beforeEach(() => {
        h.session = { user: { isAdmin: true } };
        vi.unstubAllEnvs();
    });

    it('reports each platform from its real config instead of always "connected"', async () => {
        vi.stubEnv('ZENOTI_API_KEY', '');
        vi.stubEnv('GOOGLE_PLACES_API_KEY', 'k');
        const body = await (await GET()).json();
        expect(body.platforms).toEqual([
            { name: 'Zenoti', connected: false },
            { name: 'Instagram', connected: true },
            { name: 'Facebook', connected: true },
            { name: 'YouTube', connected: false },
            { name: 'Meta Ads', connected: true },
            { name: 'Google Ads', connected: false },
            { name: 'Google Business', connected: true },
            { name: 'Search Console', connected: true },
        ]);
    });

    it('is admin-only', async () => {
        h.session = { user: { isAdmin: false } };
        expect((await GET()).status).toBe(403);
    });
});
