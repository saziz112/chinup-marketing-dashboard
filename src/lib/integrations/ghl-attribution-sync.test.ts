import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ sql: vi.fn() }));
vi.mock('@/lib/db/sql', () => ({ sql: h.sql }));

import { syncGhlAttribution } from './ghl-attribution-sync';

const text = (c: unknown[]) => (c[0] as TemplateStringsArray).join('?');
const updates = () => h.sql.mock.calls.filter(c => text(c).includes('UPDATE ghl_contacts_map'));

function pending(rows: Array<{ contact_id: string; location_key: string }>) {
    h.sql.mockImplementation(async (strings: TemplateStringsArray) =>
        strings.join('?').includes('SELECT') ? { rows } : { rows: [] });
}

describe('syncGhlAttribution', () => {
    beforeEach(() => {
        vi.stubEnv('GHL_PIT_DECATUR', 'pit-d');
        vi.stubEnv('GHL_PIT_SMYRNA', '');
        h.sql.mockReset();
    });
    afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

    it('stamps each pending contact with its attribution as a jsonb object', async () => {
        pending([{ contact_id: 'c1', location_key: 'decatur' }]);
        const attr = { sessionSource: 'Paid Social', medium: 'facebook', formName: 'Botox' };
        const fetchMock = vi.fn(async (_url: string) => ({ ok: true, json: async () => ({ contact: { attributionSource: attr } }) }));
        vi.stubGlobal('fetch', fetchMock);

        const res = await syncGhlAttribution(Date.now() + 60_000);

        expect(fetchMock.mock.calls[0][0]).toBe('https://services.leadconnectorhq.com/contacts/c1');
        const [call] = updates();
        expect(text(call)).toMatch(/attribution_source = \?::jsonb/);
        expect(JSON.parse(call[1] as string)).toEqual(attr);
        expect(res).toEqual({ fetched: 1, withAttribution: 1, failed: 0, remaining: 0 });
    });

    it('leaves a contact unstamped when GHL errors or the location has no token, so the next run retries it', async () => {
        pending([{ contact_id: 'c1', location_key: 'decatur' }, { contact_id: 'c2', location_key: 'smyrna' }]);
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) })));

        const res = await syncGhlAttribution(Date.now() + 60_000);

        expect(updates()).toHaveLength(0);
        expect(res).toEqual({ fetched: 0, withAttribution: 0, failed: 2, remaining: 2 });
    });

    it('stops at the deadline and reports what is left', async () => {
        pending([{ contact_id: 'c1', location_key: 'decatur' }]);
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        const res = await syncGhlAttribution(Date.now() - 1);

        expect(fetchMock).not.toHaveBeenCalled();
        expect(res.remaining).toBe(1);
    });
});
