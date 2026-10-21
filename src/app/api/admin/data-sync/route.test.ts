import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { email: 'x@y.com', isAdmin: true } }) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/integrations/mindbody-sync', () => ({
    getSyncStats: async () => ({ salesCount: 0, appointmentsCount: 0, clientsCount: 0, syncStates: [] }),
    getAvailableTreatments: async () => [],
}));
vi.mock('@/lib/integrations/ghl-contacts-sync', () => ({
    getGhlSyncStats: async () => ({ totalContacts: 0, byLocation: {}, withPhone: 0, withEmail: 0, lastSync: null }),
}));
vi.mock('@/lib/integrations/social-posts-sync', () => ({ getSocialPostsStats: async () => ({}) }));
vi.mock('@/lib/integrations/search-console-sync', () => ({ getSearchConsoleStats: async () => ({}) }));
vi.mock('@/lib/integrations/zenoti-sync', () => ({ incrementalZenotiSync: async () => ({}) }));
vi.mock('@/lib/db/sql', () => ({
    sql: vi.fn(async (strings: TemplateStringsArray) => {
        const q = strings.join('?');
        if (q.includes('MAX(synced_at)')) return { rows: [{ last: '2026-10-20T08:31:46.767Z' }] };
        return { rows: [] };
    }),
}));

describe('GET /api/admin/data-sync', () => {
    it('dates Zenoti clients by their last upsert, since no sync-state row tracks the daily refresh', async () => {
        const { GET } = await import('./route');
        const body = await (await GET(new NextRequest('http://x/api/admin/data-sync'))).json();
        expect(body.zenoti.clientsLastSync).toBe('2026-10-20T08:31:46.767Z');
    });
});
