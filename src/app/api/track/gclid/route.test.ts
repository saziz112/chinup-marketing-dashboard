import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({ queries: [] as { text: string; values: unknown[] }[] }));
vi.mock('@/lib/db/sql', () => ({
    sql: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        h.queries.push({ text: strings.join('?'), values });
        return { rows: [], rowCount: 1, command: '' };
    },
}));

import { POST } from './route';

function beacon(body: string, type = 'text/plain;charset=UTF-8') {
    return new NextRequest('http://x/api/track/gclid', {
        method: 'POST',
        headers: { origin: 'https://decatur-offers.chinupaesthetics.com', 'content-type': type },
        body,
    });
}

describe('POST /api/track/gclid', () => {
    beforeEach(() => {
        h.queries.length = 0;
        delete process.env.GOOGLE_ADS_OFFLINE_CONVERSION_ACTION_ID;
    });

    it('captures even before the upload side is configured, so no click is lost while parked', async () => {
        const res = await POST(beacon(JSON.stringify({ email: ' Jane@Example.com ', gclid: 'G1' })));
        expect(res.status).toBe(200);
        const insert = h.queries.find(q => q.text.includes('INSERT INTO gclid_captures'));
        expect(insert?.values.slice(0, 2)).toEqual(['jane@example.com', 'G1']);
    });

    it('accepts a sendBeacon text/plain body (the only beacon type Chrome sends cross-origin)', async () => {
        const res = await POST(beacon(JSON.stringify({ email: 'a@b.co', gclid: 'G2' })));
        expect((await res.json()).ok).toBe(true);
    });

    it('rejects malformed bodies with 400 instead of throwing', async () => {
        const res = await POST(beacon('not json'));
        expect(res.status).toBe(400);
    });

    it('restarts the click clock when a returning visitor arrives on a new gclid', async () => {
        await POST(beacon(JSON.stringify({ email: 'a@b.co', gclid: 'G3' })));
        const insert = h.queries.find(q => q.text.includes('INSERT INTO gclid_captures'))!;
        expect(insert.text).toMatch(/captured_at = CASE WHEN gclid_captures\.gclid IS DISTINCT FROM EXCLUDED\.gclid THEN NOW\(\)/);
    });
});
