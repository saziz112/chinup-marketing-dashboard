// getStaleLeads' contact-date fallback: production opportunity searches carry no
// contact.dateUpdated, so every stale candidate needs a /contacts/{id} call.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const store = vi.hoisted(() => new Map<string, unknown>());
vi.mock('@/lib/api-usage-tracker', () => ({ trackCall: () => {} }));
vi.mock('@/lib/pg-cache', () => ({
    pgCacheGet: async (k: string) => (store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : null),
    pgCacheSet: async (k: string, v: unknown) => { store.set(k, JSON.parse(JSON.stringify(v))); },
}));

const N = 200;
const T0 = new Date('2026-10-19T12:00:00Z').getTime();
let contactCalls = 0;
let msPerContact = 0;

function stubGhl() {
    contactCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => '' });
        if (url.endsWith('/pipelines/')) return ok({ pipelines: [{ id: 'p1', name: 'Main', stages: [{ id: 's1', name: 'New' }] }] });
        const contact = url.match(/\/contacts\/(c\d+)$/);
        if (contact) {
            contactCalls++;
            vi.setSystemTime(Date.now() + msPerContact);
            return ok({ contact: { id: contact[1], dateUpdated: '2026-10-18T00:00:00Z' } });
        }
        const u = new URL(url);
        if (u.searchParams.get('status') !== 'open') return ok({ meta: { total: 0 } });
        return ok({
            opportunities: Array.from({ length: N }, (_, i) => ({
                id: `o${i}`, name: `Lead ${i}`, monetaryValue: 0, pipelineId: 'p1', pipelineStageId: 's1', status: 'open', source: '',
                contact: { id: `c${i}`, name: `Lead ${i}` },
                createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
            })),
            meta: {},
        });
    }));
}

async function load() {
    vi.resetModules();
    return import('./gohighlevel');
}

describe('getStaleLeads contact-date fallback', () => {
    beforeEach(() => {
        store.clear();
        msPerContact = 0;
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(T0);
        vi.stubEnv('GHL_API_KEY_DECATUR', 'k');
        vi.stubEnv('GHL_LOCATION_ID_DECATUR', 'loc');
        vi.spyOn(console, 'log').mockImplementation(() => {});
        stubGhl();
    });
    afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

    it('stops fetching contacts once its time budget is spent and keeps the opportunity date for the rest', async () => {
        msPerContact = 1000; // 20 per batch -> each batch costs 20s of wall clock
        const { getStaleLeads } = await load();
        const stale = await getStaleLeads();
        expect(contactCalls).toBeLessThan(N);
        expect(contactCalls).toBeGreaterThan(0);
        expect(stale).toHaveLength(N - contactCalls); // fetched contacts are active (updated yesterday)
        expect(stale.every(s => s.lastActivitySource === 'opportunity')).toBe(true);
    });

    it('shares fetched contact dates with a fresh instance through Postgres', async () => {
        await (await load()).getStaleLeads();
        expect(contactCalls).toBe(N);
        store.forEach((_, k) => { if (!k.startsWith('ghl_contact_dates')) store.delete(k); });
        stubGhl();
        const stale = await (await load()).getStaleLeads();
        expect(contactCalls).toBe(0);
        expect(stale).toHaveLength(0);
    });
});
