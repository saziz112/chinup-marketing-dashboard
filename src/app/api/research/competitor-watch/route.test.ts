import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({ competitors: vi.fn() }));
vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { email: 'x@y.com' } }) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/db/sql', () => ({ sql: async () => ({ rows: [] }) }));
vi.mock('@/lib/integrations/meta-organic', () => ({ getIGCompetitorMetrics: h.competitors }));
vi.mock('../trends/route', () => ({ SERVICE_KEYWORDS: [] }));

import { GET } from './route';

describe('GET /api/research/competitor-watch', () => {
    beforeEach(() => { h.competitors.mockReset(); vi.spyOn(console, 'error').mockImplementation(() => {}); });

    it('returns an error instead of "0 competitors tracked" when the lookup fails', async () => {
        h.competitors.mockRejectedValue(new Error('every Business Discovery lookup failed'));
        const res = await GET(new NextRequest('http://x/api/research/competitor-watch?location=all'));
        expect(res.status).toBe(500);
        expect((await res.json()).error).toMatch(/Business Discovery/);
    });
});
