import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/api-usage-tracker', () => ({ trackCall: () => {} }));

type Route = (url: string) => { status?: number; body: unknown } | undefined;

function stubFetch(route: Route) {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        calls.push(url);
        const r = route(url);
        if (!r) throw new Error(`unrouted fetch: ${url}`);
        const status = r.status ?? 200;
        return { ok: status < 400, status, json: async () => r.body } as Response;
    }));
    return calls;
}

const ACCOUNT = { id: 'act_1', name: 'Chin Up', currency: 'USD', timezone_name: 'America/Detroit', account_status: 1 };

// Healthy account: one lead campaign, one traffic campaign, two pages of daily rows.
function healthyRoute(overrides: Route = () => undefined): Route {
    return (url) => {
        const o = overrides(url);
        if (o) return o;
        if (url.includes('/campaigns?')) {
            return {
                body: {
                    data: [
                        { id: 'c1', name: 'Botox Leads', status: 'ACTIVE', objective: 'OUTCOME_LEADS', start_time: '2026-01-01',
                          insights: { data: [{ spend: '100', actions: [{ action_type: 'lead', value: '10' }, { action_type: 'link_click', value: '90' }],
                                               cost_per_action_type: [{ action_type: 'lead', value: '10' }, { action_type: 'link_click', value: '1.1' }] }] } },
                        { id: 'c2', name: 'Wellness web Traffic', status: 'ACTIVE', objective: 'OUTCOME_TRAFFIC', start_time: '2026-01-01',
                          insights: { data: [{ spend: '50', actions: [{ action_type: 'link_click', value: '3088' }],
                                               cost_per_action_type: [{ action_type: 'link_click', value: '0.02' }] }] } },
                    ],
                },
            };
        }
        if (url.includes('time_increment=1')) {
            if (url.includes('after=PAGE2')) {
                return { body: { data: [{ date_start: '2026-09-02', spend: '5', actions: [{ action_type: 'link_click', value: '40' }] }] } };
            }
            return { body: { data: [{ date_start: '2026-09-01', spend: '5', actions: [{ action_type: 'lead', value: '2' }] }],
                             paging: { next: 'https://graph.facebook.com/v22.0/act_1/insights?time_increment=1&after=PAGE2' } } };
        }
        if (url.includes('/insights?')) {
            return { body: { data: [{ spend: '150', impressions: '1000', clicks: '100', reach: '800', actions: [{ action_type: 'link_click', value: '3178' }] }] } };
        }
        if (url.includes('fields=id,name,currency')) return { body: ACCOUNT };
        return undefined;
    };
}

async function load() {
    vi.resetModules();
    return import('./meta-ads');
}

describe('getMetaAdsData', () => {
    beforeEach(() => {
        vi.stubEnv('META_ADS_ACCESS_TOKEN', 'tok');
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

    it('scopes the nested campaign insights to the selected window', async () => {
        const calls = stubFetch(healthyRoute());
        const { getMetaAdsData } = await load();
        await getMetaAdsData('2026-07-01', '2026-07-31');
        const campaignsUrl = decodeURIComponent(calls.find(u => u.includes('/campaigns?'))!);
        expect(campaignsUrl).toContain('insights.time_range({"since":"2026-07-01","until":"2026-07-31"})');
    });

    it('never counts link clicks as leads', async () => {
        stubFetch(healthyRoute());
        const { getMetaAdsData } = await load();
        const data = await getMetaAdsData('2026-09-01', '2026-09-30');
        const traffic = data.campaigns.find(c => c.id === 'c2')!;
        expect(traffic.results).toBe(0);
        expect(traffic.costPerResult).toBe(0);
        expect(data.campaigns.find(c => c.id === 'c1')!.results).toBe(10);
        expect(data.account.totalResults).toBe(0);
        expect(data.dailySpend.map(d => d.results)).toEqual([2, 0]);
    });

    it('follows paging on the daily insights call', async () => {
        stubFetch(healthyRoute());
        const { getMetaAdsData } = await load();
        const data = await getMetaAdsData('2026-09-01', '2026-09-30');
        expect(data.dailySpend.map(d => d.date)).toEqual(['2026-09-01', '2026-09-02']);
    });

    it('throws on an API error instead of returning mock data, and caches nothing', async () => {
        let broken = true;
        stubFetch(healthyRoute(url => broken && url.includes('/insights?') ? { status: 401, body: { error: { message: 'expired token' } } } : undefined));
        const { getMetaAdsData } = await load();
        await expect(getMetaAdsData('2026-09-01', '2026-09-30')).rejects.toThrow(/401/);
        broken = false;
        const data = await getMetaAdsData('2026-09-01', '2026-09-30');
        expect(data.isMock).toBe(false);
        expect(data.account.totalSpend).toBe(150);
    });

    it('throws when the token is missing instead of returning mock data', async () => {
        vi.stubEnv('META_ADS_ACCESS_TOKEN', '');
        stubFetch(healthyRoute());
        const { getMetaAdsData } = await load();
        await expect(getMetaAdsData('2026-09-01', '2026-09-30')).rejects.toThrow(/not configured/i);
    });
});

describe('getMetaLeads', () => {
    beforeEach(() => {
        vi.stubEnv('META_PAGE_ACCESS_TOKEN', 'ptok');
        vi.stubEnv('META_PAGE_ID', 'page1');
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

    const lead = (id: string) => ({ id, created_time: '2026-09-05T12:00:00+0000', campaign_id: 'c1', campaign_name: 'Botox Leads', field_data: [{ name: 'email', values: [`${id}@x.com`] }] });

    it('follows paging on lead forms and on each form\'s leads', async () => {
        stubFetch(url => {
            if (url.includes('/leadgen_forms')) {
                return url.includes('after=F2')
                    ? { body: { data: [{ id: 'f2', name: 'Form 2', leads_count: 1 }] } }
                    : { body: { data: [{ id: 'f1', name: 'Form 1', leads_count: 2 }], paging: { next: 'https://graph.facebook.com/v22.0/page1/leadgen_forms?after=F2' } } };
            }
            if (url.includes('/f1/leads')) {
                return url.includes('after=L2')
                    ? { body: { data: [lead('b')] } }
                    : { body: { data: [lead('a')], paging: { next: 'https://graph.facebook.com/v22.0/f1/leads?after=L2' } } };
            }
            if (url.includes('/f2/leads')) return { body: { data: [lead('c')] } };
            return undefined;
        });
        const { getMetaLeads } = await load();
        const res = await getMetaLeads('2026-09-01', '2026-09-30');
        expect(res.leads.map(l => l.id).sort()).toEqual(['a', 'b', 'c']);
    });

    it('throws when one form fails instead of silently undercounting', async () => {
        stubFetch(url => {
            if (url.includes('/leadgen_forms')) return { body: { data: [{ id: 'f1', name: 'F1', leads_count: 1 }, { id: 'f2', name: 'F2', leads_count: 1 }] } };
            if (url.includes('/f1/leads')) return { body: { data: [lead('a')] } };
            if (url.includes('/f2/leads')) return { status: 500, body: { error: 'boom' } };
            return undefined;
        });
        const { getMetaLeads } = await load();
        await expect(getMetaLeads('2026-09-01', '2026-09-30')).rejects.toThrow();
    });

    it('throws when the page token is missing instead of returning mock leads', async () => {
        vi.stubEnv('META_PAGE_ACCESS_TOKEN', '');
        stubFetch(() => undefined);
        const { getMetaLeads } = await load();
        await expect(getMetaLeads('2026-09-01', '2026-09-30')).rejects.toThrow(/not configured/i);
    });
});
