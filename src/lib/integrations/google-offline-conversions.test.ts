import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- sql mock: records every query, answers the candidate SELECT from h.candidates ---
const h = vi.hoisted(() => ({
    queries: [] as { text: string; values: unknown[] }[],
    candidates: [] as Record<string, unknown>[],
}));
vi.mock('@/lib/db/sql', () => ({
    sql: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const text = strings.join('?');
        h.queries.push({ text, values });
        return { rows: /FROM mb_sales_history/.test(text) ? h.candidates : [], rowCount: 0, command: '' };
    },
}));

import {
    readOfflineConfig,
    endOfDayConversionTime,
    planConversions,
    runOfflineConversionUpload,
} from './google-offline-conversions';

const ENV = {
    GOOGLE_ADS_OFFLINE_CONVERSION_ACTION_ID: '987654321',
    GOOGLE_ADS_CUSTOMER_ID: '123-456-7890',
    GOOGLE_ADS_LOGIN_CUSTOMER_ID: '111-222-3333',
    GOOGLE_ADS_DEVELOPER_TOKEN: 'dev',
    GOOGLE_ADS_CLIENT_ID: 'cid',
    GOOGLE_ADS_CLIENT_SECRET: 'secret',
    GOOGLE_ADS_REFRESH_TOKEN: 'refresh',
};

describe('readOfflineConfig', () => {
    it('names every missing variable instead of failing silently', () => {
        const r = readOfflineConfig({ ...ENV, GOOGLE_ADS_OFFLINE_CONVERSION_ACTION_ID: '', GOOGLE_ADS_REFRESH_TOKEN: undefined });
        expect(r.ok).toBe(false);
        if (!r.ok) {
            expect(r.reason).toContain('GOOGLE_ADS_OFFLINE_CONVERSION_ACTION_ID');
            expect(r.reason).toContain('GOOGLE_ADS_REFRESH_TOKEN');
        }
    });

    it('rejects an action id that is not the numeric ctId', () => {
        const r = readOfflineConfig({ ...ENV, GOOGLE_ADS_OFFLINE_CONVERSION_ACTION_ID: 'customers/1/conversionActions/9' });
        expect(r.ok).toBe(false);
    });

    it('strips dashes from customer ids', () => {
        const r = readOfflineConfig(ENV);
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.config.customerId).toBe('1234567890');
            expect(r.config.loginCustomerId).toBe('1112223333');
        }
    });

    it('does not need a developer token (Data Manager is OAuth only)', () => {
        expect(readOfflineConfig({ ...ENV, GOOGLE_ADS_DEVELOPER_TOKEN: undefined }).ok).toBe(true);
    });
});

describe('endOfDayConversionTime', () => {
    it('uses the clinic-local end of day as RFC 3339 with the DST-correct offset', () => {
        expect(endOfDayConversionTime('2026-07-15').text).toBe('2026-07-15T23:59:59-04:00');
        expect(endOfDayConversionTime('2026-01-15').text).toBe('2026-01-15T23:59:59-05:00');
        expect(endOfDayConversionTime('2026-07-15').instant.toISOString()).toBe('2026-07-16T03:59:59.000Z');
    });
});

describe('planConversions', () => {
    const now = new Date('2026-10-19T14:00:00Z'); // 10 AM ET
    const row = (o: Partial<Record<string, unknown>>) => ({
        client_id: 'guest-1', sale_date: '2026-10-10', value: '250.00',
        gclid: 'G1', captured_at: new Date('2026-10-01T15:00:00Z'), ...o,
    });

    it('plans one conversion per paid visit-day with a stable order id', () => {
        const { planned } = planConversions([row({})], now);
        expect(planned).toEqual([{
            visitKey: 'zenoti-visit-guest-1-2026-10-10',
            saleDate: '2026-10-10',
            gclid: 'G1',
            eventTimestamp: '2026-10-10T23:59:59-04:00',
            value: 250,
        }]);
    });

    it('keeps a same-day visit (click in the morning, paid that afternoon)', () => {
        const { planned } = planConversions([row({ sale_date: '2026-10-01' })], now);
        expect(planned).toHaveLength(1);
    });

    it('skips visits before the click, $0 visits, today\'s incomplete day, and clicks past the 90-day window', () => {
        const { planned, skipped } = planConversions([
            row({ client_id: 'a', sale_date: '2026-09-30' }),                                     // before click
            row({ client_id: 'b', value: '0' }),                                                  // package redemption
            row({ client_id: 'c', sale_date: '2026-10-19' }),                                     // today, ET
            row({ client_id: 'd', captured_at: new Date('2026-07-01T15:00:00Z') }),               // 101 days old
        ], now);
        expect(planned).toEqual([]);
        expect(skipped.map(s => s.reason).sort()).toEqual(
            ['click_expired', 'day_not_closed', 'no_value', 'precedes_click'],
        );
    });
});

describe('runOfflineConversionUpload', () => {
    let warn: ReturnType<typeof vi.spyOn>;
    const fetchCalls: { url: string; body: string }[] = [];

    function stubFetch(upload: { status?: number; body: unknown }) {
        vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
            fetchCalls.push({ url, body: String(init?.body ?? '') });
            if (url.includes('oauth2.googleapis.com')) {
                return { ok: true, status: 200, json: async () => ({ access_token: 'tok' }), text: async () => '' } as Response;
            }
            if (url === 'https://datamanager.googleapis.com/v1/events:ingest') {
                const status = upload.status ?? 200;
                return { ok: status < 400, status, text: async () => JSON.stringify(upload.body) } as Response;
            }
            throw new Error(`unrouted fetch: ${url}`);
        }));
    }

    beforeEach(() => {
        h.queries.length = 0;
        fetchCalls.length = 0;
        h.candidates = [
            { client_id: 'guest-1', sale_date: '2026-10-10', value: '250.00', gclid: 'G1', captured_at: new Date('2026-10-01T15:00:00Z') },
            { client_id: 'guest-2', sale_date: '2026-10-11', value: '99.00', gclid: 'G2', captured_at: new Date('2026-10-02T15:00:00Z') },
        ];
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

    const now = new Date('2026-10-19T14:00:00Z');

    it('is a logged no-op (not a success) when env is missing: no DB, no Google call', async () => {
        stubFetch({ body: {} });
        const r = await runOfflineConversionUpload({ env: { ...ENV, GOOGLE_ADS_OFFLINE_CONVERSION_ACTION_ID: undefined }, now });
        expect(r.ok).toBe(false);
        expect(r.skipped).toBe(true);
        expect(r.reason).toContain('GOOGLE_ADS_OFFLINE_CONVERSION_ACTION_ID');
        expect(warn).toHaveBeenCalled();
        expect(fetchCalls).toHaveLength(0);
        expect(h.queries).toHaveLength(0);
    });

    it('sends each paid visit to Data Manager events:ingest for the conversion action', async () => {
        stubFetch({ body: { requestId: 'req-1' } });
        await runOfflineConversionUpload({ env: ENV, now });

        const ingest = fetchCalls.find(c => c.url.includes('events:ingest'))!;
        const body = JSON.parse(ingest.body);
        expect(body.destinations).toEqual([{
            operatingAccount: { accountType: 'GOOGLE_ADS', accountId: '1234567890' },
            loginAccount: { accountType: 'GOOGLE_ADS', accountId: '1112223333' },
            productDestinationId: '987654321',
        }]);
        expect(body.validateOnly).toBe(false);
        expect(body.events[0]).toEqual({
            adIdentifiers: { gclid: 'G1' },
            conversionValue: 250,
            currency: 'USD',
            eventTimestamp: '2026-10-10T23:59:59-04:00',
            transactionId: 'zenoti-visit-guest-1-2026-10-10',
            eventSource: 'WEB',
        });
        expect(body.events).toHaveLength(2);
    });

    it('records accepted visits as sent with the request id, since Google confirms them later', async () => {
        stubFetch({ body: { requestId: 'req-1' } });
        const r = await runOfflineConversionUpload({ env: ENV, now });

        expect(r).toMatchObject({ ok: true, planned: 2, sent: 2, requestId: 'req-1' });
        const writes = h.queries.filter(q => q.text.includes('INSERT INTO google_offline_uploads'));
        expect(writes).toHaveLength(2);
        expect(writes[0].values).toContain('sent');
        expect(writes[0].values).toContain('requestId req-1');
        // an older retry row for the same visit must be overwritten
        expect(writes[0].text).toContain('DO UPDATE');
    });

    it('only re-selects visits that are not already sent or done for this action', async () => {
        stubFetch({ body: { requestId: 'req-1' } });
        await runOfflineConversionUpload({ env: ENV, now });
        const select = h.queries.find(q => q.text.includes('FROM mb_sales_history'))!;
        expect(select.text).toMatch(/response_status IN \('sent', 'success', 'already_uploaded', 'failed'\)/);
        expect(select.values).toContain('987654321');
    });

    it('looks back the full 90-day click window, so an older paid visit still gets sent', async () => {
        h.candidates = [];
        stubFetch({ body: {} });
        await runOfflineConversionUpload({ env: ENV, now });
        const select = h.queries.find(q => q.text.includes('FROM mb_sales_history'))!;
        expect(select.values).toContain('2026-07-21'); // 2026-10-19 minus 90 days
    });

    it('records nothing when the request is rejected, so every visit retries next run', async () => {
        stubFetch({ status: 403, body: { error: { code: 403, message: 'PERMISSION_DENIED: datamanager scope' } } });
        const r = await runOfflineConversionUpload({ env: ENV, now });
        expect(r.ok).toBe(false);
        expect(r.error).toContain('PERMISSION_DENIED');
        expect(h.queries.filter(q => q.text.includes('INSERT INTO google_offline_uploads'))).toHaveLength(0);
    });

    it('validateOnly sends validateOnly and writes nothing', async () => {
        stubFetch({ body: { requestId: 'req-v' } });
        const r = await runOfflineConversionUpload({ env: ENV, now, validateOnly: true });
        const body = JSON.parse(fetchCalls.find(c => c.url.includes('events:ingest'))!.body);
        expect(body.validateOnly).toBe(true);
        expect(r.validateOnly).toBe(true);
        expect(r.sent).toBe(0);
        expect(h.queries.filter(q => q.text.includes('INSERT INTO google_offline_uploads'))).toHaveLength(0);
    });

    it('also matches visits to the gclid GHL recorded on the lead, not only the website beacon', async () => {
        h.candidates = [];
        stubFetch({ body: {} });
        await runOfflineConversionUpload({ env: ENV, now });
        const q = h.queries.find(x => x.text.includes('FROM mb_sales_history'))!.text;
        expect(q).toMatch(/FROM gclid_captures/);
        expect(q).toMatch(/attribution_source->>'gclid'/);
    });

    it('does not call Google when nothing is pending', async () => {
        h.candidates = [];
        stubFetch({ body: {} });
        const r = await runOfflineConversionUpload({ env: ENV, now });
        expect(r).toMatchObject({ ok: true, planned: 0, sent: 0 });
        expect(fetchCalls).toHaveLength(0);
    });
});
