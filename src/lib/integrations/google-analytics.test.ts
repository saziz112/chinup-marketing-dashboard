import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const runReport = vi.fn();
vi.mock('googleapis', () => ({
    google: {
        auth: { JWT: class {} },
        analyticsdata: () => ({ properties: { runReport } }),
    },
}));

async function load() {
    vi.resetModules();
    return import('./google-analytics');
}

describe('getTrafficSources', () => {
    beforeEach(() => {
        vi.stubEnv('GA4_PROPERTY_ID', '123');
        vi.stubEnv('GOOGLE_CLIENT_EMAIL', 'svc@x.iam');
        vi.stubEnv('GOOGLE_PRIVATE_KEY', 'key');
        runReport.mockReset();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

    it('throws on an API error instead of returning demo traffic, and caches nothing', async () => {
        runReport.mockRejectedValue(new Error('PERMISSION_DENIED'));
        const { getTrafficSources } = await load();
        await expect(getTrafficSources(30)).rejects.toThrow(/PERMISSION_DENIED/);
        runReport.mockResolvedValue({ data: { rows: [{ dimensionValues: [{ value: 'instagram' }, { value: 'referral' }], metricValues: [{ value: '4' }, { value: '3' }] }] } });
        expect((await getTrafficSources(30)).instagramVisits).toBe(4);
    });

    it('throws when GA4 is not configured instead of returning demo traffic', async () => {
        vi.stubEnv('GA4_PROPERTY_ID', '');
        const { getTrafficSources } = await load();
        await expect(getTrafficSources(30)).rejects.toThrow(/not configured/i);
    });
});
