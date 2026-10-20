import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const query = vi.fn();
const track = vi.fn();
vi.mock('@/lib/api-usage-tracker', () => ({ trackCall: (...a: unknown[]) => track(...a) }));
vi.mock('googleapis', () => ({
    google: {
        auth: { JWT: class {} },
        searchconsole: () => ({ searchanalytics: { query } }),
    },
}));

async function load() {
    vi.resetModules();
    return import('./search-console');
}

describe('getSearchConsoleData', () => {
    beforeEach(() => {
        vi.stubEnv('GOOGLE_CLIENT_EMAIL', 'svc@x.iam');
        vi.stubEnv('GOOGLE_PRIVATE_KEY', 'key');
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-19T12:00:00Z'));
        query.mockReset();
        track.mockReset();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

    it('throws on an API error instead of returning random data, and caches nothing', async () => {
        query.mockRejectedValue(new Error('User does not have sufficient permission'));
        const { getSearchConsoleData } = await load();
        await expect(getSearchConsoleData(30)).rejects.toThrow(/permission/);
        query.mockResolvedValue({ data: { rows: [{ keys: ['2026-10-01'], clicks: 7, impressions: 100, position: 10 }] } });
        expect((await getSearchConsoleData(30)).totals.clicks).toBe(7);
    });

    it('throws when credentials are missing instead of returning random data', async () => {
        vi.stubEnv('GOOGLE_CLIENT_EMAIL', '');
        const { getSearchConsoleData } = await load();
        await expect(getSearchConsoleData(30)).rejects.toThrow();
    });

    it('requests exactly N days for an N-day period', async () => {
        query.mockResolvedValue({ data: { rows: [] } });
        const { getSearchConsoleData } = await load();
        await getSearchConsoleData(30);
        const { startDate, endDate } = query.mock.calls[0][0].requestBody;
        expect(endDate).toBe('2026-10-17');
        expect(startDate).toBe('2026-09-18'); // 9/18..10/17 inclusive = 30 days
    });

    it('records each Search Console query in API usage, and a cache hit as cached', async () => {
        query.mockResolvedValue({ data: { rows: [] } });
        const { getSearchConsoleData } = await load();
        await getSearchConsoleData(30);
        await getSearchConsoleData(30);
        expect(track.mock.calls.filter(c => c[0] === 'googleSearchConsole' && c[2] === false)).toHaveLength(3);
        expect(track.mock.calls.filter(c => c[0] === 'googleSearchConsole' && c[2] === true)).toHaveLength(1);
    });
});
