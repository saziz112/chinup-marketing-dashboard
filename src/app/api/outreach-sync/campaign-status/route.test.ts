import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ sql: vi.fn() }));
vi.mock('@/lib/db/sql', () => ({ sql: h.sql }));

import { GET } from './route';

const req = (auth?: string) =>
    new Request('http://x/api/outreach-sync/campaign-status', { headers: auth ? { authorization: auth } : {} }) as never;

describe('GET campaign-status', () => {
    beforeEach(() => { process.env.OUTREACH_SYNC_SECRET = 's3cret'; h.sql.mockReset(); vi.spyOn(console, 'error').mockImplementation(() => {}); });
    afterEach(() => { delete process.env.OUTREACH_SYNC_SECRET; });

    it('rejects a missing or wrong secret', async () => {
        expect((await GET(req())).status).toBe(401);
        expect((await GET(req('Bearer nope'))).status).toBe(401);
        expect(h.sql).not.toHaveBeenCalled();
    });

    it('returns the last run that actually sent, per segment', async () => {
        h.sql.mockResolvedValue({ rows: [{ segment: 'maintenance', last_sent_at: '2026-09-28T15:00:00Z' }] });
        const res = await GET(req('Bearer s3cret'));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ segments: [{ segment: 'maintenance', lastSentAt: '2026-09-28T15:00:00.000Z' }] });
        expect((h.sql.mock.calls[0][0] as TemplateStringsArray).join('?')).toContain('total_sent > 0');
    });

    it('returns 500 when the database fails', async () => {
        h.sql.mockRejectedValue(new Error('db down'));
        expect((await GET(req('Bearer s3cret'))).status).toBe(500);
    });
});
