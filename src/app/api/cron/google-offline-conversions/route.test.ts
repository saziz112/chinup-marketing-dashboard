import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const h = vi.hoisted(() => ({ authorized: false, run: vi.fn() }));
vi.mock('@/lib/cron-auth', () => ({ isCronAuthorized: () => h.authorized }));
vi.mock('next-auth', () => ({ getServerSession: async () => null }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/integrations/google-offline-conversions', () => ({ runOfflineConversionUpload: h.run }));

import { GET } from './route';

describe('GET /api/cron/google-offline-conversions', () => {
    beforeEach(() => {
        h.run.mockReset().mockResolvedValue({ ok: true, planned: 0, uploaded: 0 });
    });

    it('rejects callers without the cron secret or an admin session', async () => {
        h.authorized = false;
        const res = await GET(new NextRequest('http://x/api/cron/google-offline-conversions'));
        expect(res.status).toBe(401);
        expect(h.run).not.toHaveBeenCalled();
    });

    it('passes validateOnly through for a dry run', async () => {
        h.authorized = true;
        await GET(new NextRequest('http://x/api/cron/google-offline-conversions?validateOnly=1'));
        expect(h.run).toHaveBeenCalledWith({ validateOnly: true });
    });

    it('surfaces a whole-request failure as a non-2xx so the cron shows red', async () => {
        h.authorized = true;
        h.run.mockResolvedValue({ ok: false, error: 'USER_PERMISSION_DENIED' });
        const res = await GET(new NextRequest('http://x/api/cron/google-offline-conversions'));
        expect(res.status).toBe(502);
    });

    it('keeps an unconfigured run at 200 but not ok', async () => {
        h.authorized = true;
        h.run.mockResolvedValue({ ok: false, skipped: true, reason: 'missing env: X' });
        const res = await GET(new NextRequest('http://x/api/cron/google-offline-conversions'));
        expect(res.status).toBe(200);
        expect((await res.json()).ok).toBe(false);
    });
});

describe('vercel.json', () => {
    const crons: { path: string; schedule: string }[] =
        JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')).crons;

    it('schedules the upload daily after the Zenoti sync, on its own slot', () => {
        const job = crons.find(c => c.path === '/api/cron/google-offline-conversions');
        expect(job?.schedule).toBe('0 10 * * *');
        const zenoti = crons.find(c => c.path === '/api/cron/sync-zenoti')!;
        expect(Number(zenoti.schedule.split(' ')[1])).toBeLessThan(10);
        expect(new Set(crons.map(c => c.schedule)).size).toBe(crons.length);
    });
});
