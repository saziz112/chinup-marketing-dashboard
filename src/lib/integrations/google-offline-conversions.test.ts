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
    classifyResults,
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

    it('strips dashes from customer ids and builds the resource name', () => {
        const r = readOfflineConfig(ENV);
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.config.customerId).toBe('1234567890');
            expect(r.config.loginCustomerId).toBe('1112223333');
            expect(r.config.conversionAction).toBe('customers/1234567890/conversionActions/987654321');
        }
    });
});

describe('endOfDayConversionTime', () => {
    it('uses the clinic-local end of day with the DST-correct offset in the API format', () => {
        expect(endOfDayConversionTime('2026-07-15').text).toBe('2026-07-15 23:59:59-04:00');
        expect(endOfDayConversionTime('2026-01-15').text).toBe('2026-01-15 23:59:59-05:00');
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
            conversionDateTime: '2026-10-10 23:59:59-04:00',
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

describe('classifyResults', () => {
    const failure = (index: number, code: string) => ({
        errorCode: { conversionUploadError: code },
        message: `${code} message`,
        location: { fieldPathElements: [{ fieldName: 'conversions', index }, { fieldName: 'gclid' }] },
    });

    it('maps each row to its own partial-failure error by index', () => {
        const out = classifyResults({
            results: [{ gclid: 'A', conversionAction: 'x' }, {}, {}, {}],
            partialFailureError: {
                code: 3, message: 'multiple',
                details: [{ errors: [failure(1, 'EXPIRED_EVENT'), failure(2, 'TOO_RECENT_EVENT'), failure(3, 'CLICK_CONVERSION_ALREADY_EXISTS')] }],
            },
        }, 4);
        expect(out.map(o => o.status)).toEqual(['success', 'failed', 'retry', 'already_uploaded']);
        expect(out[1].error).toContain('EXPIRED_EVENT');
        expect(out[0].error).toBeNull();
    });

    it('treats an empty row with no matching error as retryable, never as done', () => {
        const out = classifyResults({ results: [{}] }, 1);
        expect(out[0].status).toBe('retry');
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
            if (url.includes(':uploadClickConversions')) {
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

    it('uploads to v23 with partial failure and records each row\'s own outcome', async () => {
        stubFetch({ body: {
            results: [{ gclid: 'G1', conversionAction: 'x' }, {}],
            partialFailureError: { code: 3, message: 'm', details: [{ errors: [{
                errorCode: { conversionUploadError: 'EXPIRED_EVENT' }, message: 'expired',
                location: { fieldPathElements: [{ fieldName: 'conversions', index: 1 }] },
            }] }] },
        } });
        const r = await runOfflineConversionUpload({ env: ENV, now });

        const upload = fetchCalls.find(c => c.url.includes(':uploadClickConversions'))!;
        expect(upload.url).toBe('https://googleads.googleapis.com/v23/customers/1234567890:uploadClickConversions');
        const body = JSON.parse(upload.body);
        expect(body.partialFailure).toBe(true);
        expect(body.validateOnly).toBe(false);
        expect(body.conversions[0]).toEqual({
            gclid: 'G1',
            conversionAction: 'customers/1234567890/conversionActions/987654321',
            conversionDateTime: '2026-10-10 23:59:59-04:00',
            conversionValue: 250,
            currencyCode: 'USD',
            orderId: 'zenoti-visit-guest-1-2026-10-10',
        });

        expect(r).toMatchObject({ ok: true, planned: 2, uploaded: 1, failed: 1, retry: 0 });
        const writes = h.queries.filter(q => q.text.includes('INSERT INTO google_offline_uploads'));
        expect(writes).toHaveLength(2);
        expect(writes[0].values).toContain('success');
        expect(writes[1].values).toContain('failed');
        // a retry row must be updatable later, so the write upserts instead of DO NOTHING
        expect(writes[0].text).toContain('DO UPDATE');
    });

    it('only re-selects visits that are not already done for this action', async () => {
        stubFetch({ body: { results: [{ gclid: 'G1' }, { gclid: 'G2' }] } });
        await runOfflineConversionUpload({ env: ENV, now });
        const select = h.queries.find(q => q.text.includes('FROM mb_sales_history'))!;
        expect(select.text).toMatch(/response_status IN \('success', 'already_uploaded', 'failed'\)/);
        expect(select.values).toContain('987654321');
    });

    it('records nothing when the whole request fails, so every visit retries next run', async () => {
        stubFetch({ status: 403, body: { error: { code: 403, message: 'USER_PERMISSION_DENIED' } } });
        const r = await runOfflineConversionUpload({ env: ENV, now });
        expect(r.ok).toBe(false);
        expect(r.error).toContain('USER_PERMISSION_DENIED');
        expect(h.queries.filter(q => q.text.includes('INSERT INTO google_offline_uploads'))).toHaveLength(0);
    });

    it('validateOnly sends validate_only and writes nothing', async () => {
        stubFetch({ body: {} });
        const r = await runOfflineConversionUpload({ env: ENV, now, validateOnly: true });
        const body = JSON.parse(fetchCalls.find(c => c.url.includes(':uploadClickConversions'))!.body);
        expect(body.validateOnly).toBe(true);
        expect(r.validateOnly).toBe(true);
        expect(h.queries.filter(q => q.text.includes('INSERT INTO google_offline_uploads'))).toHaveLength(0);
    });

    it('does not call Google when nothing is pending', async () => {
        h.candidates = [];
        stubFetch({ body: {} });
        const r = await runOfflineConversionUpload({ env: ENV, now });
        expect(r).toMatchObject({ ok: true, planned: 0, uploaded: 0 });
        expect(fetchCalls).toHaveLength(0);
    });
});
