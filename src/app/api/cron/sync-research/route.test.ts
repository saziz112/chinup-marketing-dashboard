import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({ order: [] as string[], attribution: vi.fn() }));
vi.mock('@/lib/cron-auth', () => ({ isCronAuthorized: () => true }));
vi.mock('@/lib/pg-cache', () => ({ pgCacheInvalidatePrefix: async () => {} }));
vi.mock('@/lib/integrations/social-posts-sync', () => ({ incrementalSocialSync: async () => ({ total: 0, apiCalls: 0, done: true, chunkLabel: '' }) }));
vi.mock('@/lib/integrations/search-console-sync', () => ({ incrementalSearchConsoleSync: async () => ({ total: 0, apiCalls: 0, done: true, chunkLabel: '' }) }));
vi.mock('@/lib/integrations/ghl-contacts-sync', () => ({
    incrementalGhlSync: async () => { h.order.push('contacts'); return { newContacts: 3, apiCalls: 1 }; },
}));
vi.mock('@/lib/integrations/ghl-attribution-sync', () => ({ syncGhlAttribution: h.attribution }));

import { GET } from './route';

describe('GET /api/cron/sync-research', () => {
    beforeEach(() => {
        h.order.length = 0;
        h.attribution.mockReset().mockImplementation(async () => { h.order.push('attribution'); return { fetched: 3, withAttribution: 2, failed: 0, remaining: 0 }; });
    });

    it('stamps attribution after the contacts sync lands new contacts', async () => {
        const body = await (await GET(new NextRequest('http://x/api/cron/sync-research'))).json();
        expect(h.order).toEqual(['contacts', 'attribution']);
        expect(body.ghl.attribution).toEqual({ fetched: 3, withAttribution: 2, failed: 0, remaining: 0 });
    });

    it('reports an attribution failure without failing the whole sync', async () => {
        h.attribution.mockRejectedValue(new Error('db down'));
        const res = await GET(new NextRequest('http://x/api/cron/sync-research'));
        expect(res.status).toBe(200);
        expect((await res.json()).ghl.attribution).toEqual({ error: 'db down' });
    });
});
