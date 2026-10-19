import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ count: vi.fn() }));
vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { name: 'x' } }) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/integrations/mindbody-db', () => ({ getNewClientsCountFromDB: h.count }));

import { GET } from './route';

describe('GET /api/metrics/leads', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-19T15:00:00'));
        h.count.mockReset().mockResolvedValue(42);
    });
    afterEach(() => vi.useRealTimers());

    it('counts exactly N calendar days ending today for an N-day period', async () => {
        const res = await GET(new Request('http://x/api/metrics/leads?period=30d'));
        const body = await res.json();
        expect(h.count).toHaveBeenCalledWith('2026-09-20T00:00:00', '2026-10-19T23:59:59');
        expect(body.count).toBe(42);
    });
});
