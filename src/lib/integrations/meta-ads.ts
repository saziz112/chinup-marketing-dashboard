/**
 * Meta Marketing API Client — Paid Ads
 * Ad Account: act_489484611603727
 * Requires: META_ADS_ACCESS_TOKEN with ads_read permission.
 *
 * How to get META_ADS_ACCESS_TOKEN:
 *   1. Go to https://developers.facebook.com/tools/explorer/
 *   2. Select App: Chin Up Dashboard, generate token with ads_read + ads_management
 *   3. Exchange for long-lived: POST /oauth/access_token?grant_type=fb_exchange_token&...
 *   4. Add to .env.local as META_ADS_ACCESS_TOKEN=...
 *
 * When not configured, serves realistic mock data for immediate UI development.
 */

import { trackCall } from '@/lib/api-usage-tracker';
import { createMemCache } from '@/lib/mem-cache';

// --- Types ---

export type CampaignStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED' | 'DELETED';
export type CampaignObjective =
    | 'OUTCOME_LEADS'
    | 'OUTCOME_AWARENESS'
    | 'OUTCOME_TRAFFIC'
    | 'OUTCOME_ENGAGEMENT'
    | 'OUTCOME_SALES'
    | 'REACH'
    | 'LINK_CLICKS'
    | 'LEAD_GENERATION'
    | string;

export interface MetaAdAccountSummary {
    id: string;
    name: string;
    currency: string;
    timezone: string;
    accountStatus: number; // 1=active, 2=disabled
    totalSpend: number;     // in account currency
    totalImpressions: number;
    totalClicks: number;
    totalReach: number;
    totalResults: number;   // leads / purchases as configured
}

export interface MetaCampaign {
    id: string;
    name: string;
    status: CampaignStatus;
    objective: CampaignObjective;
    spend: number;
    impressions: number;
    clicks: number;
    reach: number;
    frequency: number;
    cpm: number;    // cost per mille
    cpc: number;    // cost per click
    ctr: number;    // click-through rate (%)
    results: number;         // conversions (leads/purchases)
    costPerResult: number;   // spend / results
    roas: number;            // return on ad spend (Meta-reported)
    startTime: string;
    stopTime: string | null;
}

export interface MetaDailySpend {
    date: string;  // YYYY-MM-DD
    spend: number;
    impressions: number;
    clicks: number;
    results: number;
}

export interface MetaAdsData {
    isConfigured: boolean;
    isMock: boolean;
    account: MetaAdAccountSummary;
    campaigns: MetaCampaign[];
    dailySpend: MetaDailySpend[];
}

// --- Constants ---

const AD_ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID || 'act_489484611603727';
const GRAPH_BASE = 'https://graph.facebook.com/v22.0';

// --- Helpers ---

function getOptionalEnv(key: string): string | null {
    return process.env[key] || null;
}

export function isMetaAdsConfigured(): boolean {
    return !!getOptionalEnv('META_ADS_ACCESS_TOKEN');
}

// --- Cache ---

const adsCache = createMemCache<unknown>(4 * 60 * 60 * 1000); // 4 hours

function getCached<T>(key: string): T | null {
    return adsCache.get(key) as T | null;
}

function setCache(key: string, data: unknown): void {
    adsCache.set(key, data);
}

// --- API Helper ---

async function adsGet<T>(endpoint: string, token: string): Promise<T> {
    const sep = endpoint.includes('?') ? '&' : '?';
    const url = `${GRAPH_BASE}${endpoint}${sep}access_token=${token}`;
    const response = await fetch(url);
    trackCall('metaAds', endpoint.split('?')[0], false);

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(`Meta Ads API error: ${response.status} ${endpoint} — ${JSON.stringify(err)}`);
    }
    return response.json() as Promise<T>;
}

// --- Insight field parser ---

function parseInsights(insights: {
    data: Array<{
        spend?: string;
        impressions?: string;
        clicks?: string;
        reach?: string;
        frequency?: string;
        cpm?: string;
        cpc?: string;
        ctr?: string;
        actions?: Array<{ action_type: string; value: string }>;
        cost_per_action_type?: Array<{ action_type: string; value: string }>;
        action_values?: Array<{ action_type: string; value: string }>;
    }>;
} | null | undefined): {
    spend: number;
    impressions: number;
    clicks: number;
    reach: number;
    frequency: number;
    cpm: number;
    cpc: number;
    ctr: number;
    results: number;
    costPerResult: number;
    roas: number;
} {
    const d = insights?.data?.[0];
    if (!d) return { spend: 0, impressions: 0, clicks: 0, reach: 0, frequency: 0, cpm: 0, cpc: 0, ctr: 0, results: 0, costPerResult: 0, roas: 0 };

    const getAction = (arr: Array<{ action_type: string; value: string }> | undefined, type: string) =>
        parseFloat(arr?.find(a => a.action_type === type)?.value || '0');

    const spend = parseFloat(d.spend || '0');
    const impressions = parseInt(d.impressions || '0');
    const clicks = parseInt(d.clicks || '0');
    const reach = parseInt(d.reach || '0');
    const frequency = parseFloat(d.frequency || '0');
    const cpm = parseFloat(d.cpm || '0');
    const cpc = parseFloat(d.cpc || '0');
    const ctr = parseFloat(d.ctr || '0');

    // Results = leads (primary) or link_clicks as fallback
    let results = getAction(d.actions, 'lead') || getAction(d.actions, 'onsite_conversion.lead_grouped');
    if (!results) results = getAction(d.actions, 'offsite_conversion.fb_pixel_lead');
    if (!results) results = getAction(d.actions, 'link_click');

    // Cost per result
    const costPerAction = d.cost_per_action_type;
    let costPerResult = 0;
    if (costPerAction) {
        costPerResult = parseFloat(costPerAction.find(a => a.action_type === 'lead')?.value || '0')
            || parseFloat(costPerAction.find(a => a.action_type === 'link_click')?.value || '0');
    }
    if (!costPerResult && results > 0) costPerResult = spend / results;

    // ROAS from purchase action values
    const purchaseValue = getAction(d.action_values, 'offsite_conversion.fb_pixel_purchase');
    const roas = spend > 0 && purchaseValue > 0 ? purchaseValue / spend : 0;

    return { spend, impressions, clicks, reach, frequency, cpm, cpc, ctr, results, costPerResult, roas };
}

// --- Live API Functions ---

async function fetchAccountSummary(token: string, since: string, until: string): Promise<MetaAdAccountSummary> {
    // Account info
    const accountData = await adsGet<{
        id: string;
        name: string;
        currency: string;
        timezone_name: string;
        account_status: number;
    }>(`/${AD_ACCOUNT_ID}?fields=id,name,currency,timezone_name,account_status`, token);

    // Account-level insights
    const insightsData = await adsGet<{
        data: Array<{
            spend?: string;
            impressions?: string;
            clicks?: string;
            reach?: string;
            actions?: Array<{ action_type: string; value: string }>;
        }>;
    }>(`/${AD_ACCOUNT_ID}/insights?fields=spend,impressions,clicks,reach,actions&time_range={"since":"${since}","until":"${until}"}`, token);

    const ins = parseInsights(insightsData);

    return {
        id: accountData.id,
        name: accountData.name,
        currency: accountData.currency,
        timezone: accountData.timezone_name,
        accountStatus: accountData.account_status,
        totalSpend: ins.spend,
        totalImpressions: ins.impressions,
        totalClicks: ins.clicks,
        totalReach: ins.reach,
        totalResults: ins.results,
    };
}

async function fetchCampaigns(token: string, since: string, until: string): Promise<MetaCampaign[]> {
    const data = await adsGet<{
        data: Array<{
            id: string;
            name: string;
            status: CampaignStatus;
            objective: string;
            start_time: string;
            stop_time?: string;
            insights?: {
                data: Array<{
                    spend?: string;
                    impressions?: string;
                    clicks?: string;
                    reach?: string;
                    frequency?: string;
                    cpm?: string;
                    cpc?: string;
                    ctr?: string;
                    actions?: Array<{ action_type: string; value: string }>;
                    cost_per_action_type?: Array<{ action_type: string; value: string }>;
                    action_values?: Array<{ action_type: string; value: string }>;
                }>;
            };
        }>;
        paging?: unknown;
    }>(
        `/${AD_ACCOUNT_ID}/campaigns?fields=id,name,status,objective,start_time,stop_time,insights{spend,impressions,clicks,reach,frequency,cpm,cpc,ctr,actions,cost_per_action_type,action_values}&time_range={"since":"${since}","until":"${until}"}&limit=50`,
        token
    );

    return (data.data || []).map(c => {
        const ins = parseInsights(c.insights || null);
        return {
            id: c.id,
            name: c.name,
            status: c.status,
            objective: c.objective,
            spend: ins.spend,
            impressions: ins.impressions,
            clicks: ins.clicks,
            reach: ins.reach,
            frequency: ins.frequency,
            cpm: ins.cpm,
            cpc: ins.cpc,
            ctr: ins.ctr,
            results: ins.results,
            costPerResult: ins.costPerResult,
            roas: ins.roas,
            startTime: c.start_time,
            stopTime: c.stop_time || null,
        };
    });
}

async function fetchDailySpend(token: string, since: string, until: string): Promise<MetaDailySpend[]> {
    const data = await adsGet<{
        data: Array<{
            spend?: string;
            impressions?: string;
            clicks?: string;
            actions?: Array<{ action_type: string; value: string }>;
            date_start: string;
        }>;
    }>(
        `/${AD_ACCOUNT_ID}/insights?fields=spend,impressions,clicks,actions&time_increment=1&time_range={"since":"${since}","until":"${until}"}`,
        token
    );

    return (data.data || []).map(d => {
        const getAction = (type: string) =>
            parseFloat(d.actions?.find(a => a.action_type === type)?.value || '0');
        const results = getAction('lead') || getAction('onsite_conversion.lead_grouped') || getAction('link_click');
        return {
            date: d.date_start,
            spend: parseFloat(d.spend || '0'),
            impressions: parseInt(d.impressions || '0'),
            clicks: parseInt(d.clicks || '0'),
            results,
        };
    });
}

// --- Main Export ---

export async function getMetaAdsData(since: string, until: string): Promise<MetaAdsData> {
    const cacheKey = `meta_ads_${since}_${until}`;
    const cached = getCached<MetaAdsData>(cacheKey);
    if (cached) { trackCall('metaAds', 'getMetaAdsData', true); return cached; }

    const token = getOptionalEnv('META_ADS_ACCESS_TOKEN');
    if (!token) {
        const mock = getMockData(since, until);
        setCache(cacheKey, mock);
        return mock;
    }

    try {
        const [account, campaigns, dailySpend] = await Promise.all([
            fetchAccountSummary(token, since, until),
            fetchCampaigns(token, since, until),
            fetchDailySpend(token, since, until),
        ]);

        const result: MetaAdsData = {
            isConfigured: true,
            isMock: false,
            account,
            campaigns,
            dailySpend,
        };
        setCache(cacheKey, result);
        return result;
    } catch (err) {
        console.error('[MetaAds] Live API failed, falling back to mock:', err);
        const mock = getMockData(since, until);
        setCache(cacheKey, mock);
        return mock;
    }
}

// --- Lead Ads API ---
// Only works for campaigns with objective OUTCOME_LEADS / LEAD_GENERATION that use native FB lead forms.
// Returns actual lead form submissions with email per campaign.

export interface MetaLead {
    id: string;
    createdTime: string;
    campaignId: string;
    campaignName: string;
    adId: string;
    email: string | null;
    phone: string | null;
    firstName: string | null;
    lastName: string | null;
}

interface RawLeadFieldData {
    name: string;
    values: string[];
}

/**
 * Fetch lead form submissions from Meta Lead Ads API for a date range.
 * Returns leads with email, phone, name — keyed by campaignId.
 * 
 * IMPORTANT: Only works for Lead Generation campaigns using native Facebook lead forms.
 * Traffic/awareness campaigns that send users to a landing page won't appear here.
 * Requires ads_read permission (which META_ADS_ACCESS_TOKEN has).
 */
export async function getMetaLeads(since: string, until: string): Promise<{
    leads: MetaLead[];
    byCampaign: Map<string, MetaLead[]>;
    totalLeads: number;
    hasLeadForms: boolean;
}> {
    const cacheKey = `meta_leads_${since}_${until}`;
    const cached = getCached<{ leads: MetaLead[]; byCampaign: Map<string, MetaLead[]>; totalLeads: number; hasLeadForms: boolean }>(cacheKey);
    if (cached) { trackCall('metaAds', 'getMetaLeads', true); return cached; }

    // NOTE: leadgen_forms and lead submissions require a PAGE Access Token,
    // not the ad account token. We use META_PAGE_ACCESS_TOKEN (permanent).
    const pageToken = process.env.META_PAGE_ACCESS_TOKEN;
    const pageId = process.env.META_PAGE_ID;

    if (!pageToken || !pageId) {
        console.warn('[MetaLeads] META_PAGE_ACCESS_TOKEN or META_PAGE_ID not configured. Using Mock Data.');
        return getMockLeads(since, until);
    }

    try {
        // Fetch all lead gen forms from the page (requires page token, NOT ads token)
        // Using direct fetch to avoid adsGet which may mix tokens
        const formsUrl = `${GRAPH_BASE}/${pageId}/leadgen_forms?fields=id,name,leads_count&limit=100&access_token=${pageToken}`;
        const formsRes = await fetch(formsUrl);
        trackCall('metaAds', '/leadgen_forms', false);
        if (!formsRes.ok) {
            const err = await formsRes.json().catch(() => ({}));
            throw new Error(`leadgen_forms error: ${formsRes.status} — ${JSON.stringify(err)}`);
        }
        const formsData = await formsRes.json() as { data: Array<{ id: string; name: string; leads_count?: number }> };

        if (!formsData.data?.length) {
            return { leads: [], byCampaign: new Map(), totalLeads: 0, hasLeadForms: false };
        }

        // Filter to forms that actually have leads
        const formsWithLeads = formsData.data.filter(f => (f.leads_count || 0) > 0);
        if (!formsWithLeads.length) {
            // Forms exist but no leads yet
            return { leads: [], byCampaign: new Map(), totalLeads: 0, hasLeadForms: true };
        }

        // Date filter as Unix timestamps
        const sinceTs = Math.floor(new Date(since).getTime() / 1000);
        const untilTs = Math.floor(new Date(until + 'T23:59:59').getTime() / 1000);

        const allLeads: MetaLead[] = [];
        const byCampaign = new Map<string, MetaLead[]>();

        // Fetch leads from each form (page token required)
        await Promise.all(formsWithLeads.map(async form => {
            try {
                const filterStr = encodeURIComponent(JSON.stringify([
                    { field: 'time_created', operator: 'GREATER_THAN', value: sinceTs },
                    { field: 'time_created', operator: 'LESS_THAN', value: untilTs },
                ]));
                const leadsUrl = `${GRAPH_BASE}/${form.id}/leads` +
                    `?fields=id,created_time,ad_id,campaign_id,campaign_name,field_data` +
                    `&filtering=${filterStr}` +
                    `&limit=500` +
                    `&access_token=${pageToken}`;
                const leadsRes = await fetch(leadsUrl);
                trackCall('metaAds', '/form/leads', false);
                if (!leadsRes.ok) {
                    const err = await leadsRes.json().catch(() => ({}));
                    console.warn(`[MetaLeads] form ${form.id} error:`, err);
                    return;
                }
                const leadsData = await leadsRes.json() as {
                    data: Array<{
                        id: string;
                        created_time: string;
                        ad_id?: string;
                        campaign_id?: string;
                        campaign_name?: string;
                        field_data: RawLeadFieldData[];
                    }>;
                };

                for (const raw of leadsData.data || []) {
                    const getField = (name: string) =>
                        raw.field_data?.find(f =>
                            f.name === name ||
                            f.name.toLowerCase().includes(name.toLowerCase())
                        )?.values?.[0] || null;

                    const lead: MetaLead = {
                        id: raw.id,
                        createdTime: raw.created_time,
                        campaignId: raw.campaign_id || form.id,
                        campaignName: raw.campaign_name || form.name,
                        adId: raw.ad_id || '',
                        email: getField('email'),
                        phone: getField('phone_number') || getField('phone'),
                        firstName: getField('first_name'),
                        lastName: getField('last_name'),
                    };

                    allLeads.push(lead);
                    const arr = byCampaign.get(lead.campaignId) || [];
                    arr.push(lead);
                    byCampaign.set(lead.campaignId, arr);
                }
            } catch (err) {
                console.warn(`[MetaLeads] Could not fetch leads for form ${form.id}:`, err);
            }
        }));

        const result = {
            leads: allLeads,
            byCampaign,
            totalLeads: allLeads.length,
            hasLeadForms: true,
        };
        setCache(cacheKey, result);
        return result;
    } catch (err) {
        console.error('[MetaLeads] Failed to fetch leads:', err);
        return { leads: [], byCampaign: new Map(), totalLeads: 0, hasLeadForms: false };
    }
}


// --- Mock Data Helpers ---

function getMockLeads(since: string, until: string): { leads: MetaLead[]; byCampaign: Map<string, MetaLead[]>; totalLeads: number; hasLeadForms: boolean } {
    // We generate some mock leads corresponding to the mock campaigns in `getMockData`.
    // Campaign 1: mock_camp_1 (Botox)
    // Campaign 2: mock_camp_2 (Filler)
    // Campaign 3: mock_camp_3 (Hydrafacial)

    // Hardcode a few known emails from the MindBody mock dataset if we want them to "match",
    // or just generate random ones. Let's use some common names.
    const mockEmailsThatMatch = ['sam.aziz@chinupaesthetics.com', 'sharia@chinupaesthetics.com', 'test@example.com', 'john.doe@gmail.com', 'jane.smith@yahoo.com'];
    const randomEmails = ['user1@mail.com', 'lead2@test.org', 'nopurchase@gmail.com', 'info@nobody.com'];

    const allLeads: MetaLead[] = [];
    const byCampaign = new Map<string, MetaLead[]>();

    const generateLeads = (campId: string, campName: string, count: number, matchedCount: number) => {
        for (let i = 0; i < count; i++) {
            const isMatched = i < matchedCount;
            const email = isMatched ? mockEmailsThatMatch[i % mockEmailsThatMatch.length] : randomEmails[i % randomEmails.length];

            const lead: MetaLead = {
                id: `mock_lead_${campId}_${i}`,
                createdTime: new Date().toISOString(),
                campaignId: campId,
                campaignName: campName,
                adId: `mock_ad_${i}`,
                email,
                phone: '555-0100',
                firstName: isMatched ? 'Matched' : 'Unmatched',
                lastName: `User ${i}`,
            };
            allLeads.push(lead);
            const arr = byCampaign.get(campId) || [];
            arr.push(lead);
            byCampaign.set(campId, arr);
        }
    };

    // ~25 total mock leads
    generateLeads('mock_camp_1', 'Botox Special — Spring 2026', 15, 6);
    generateLeads('mock_camp_2', 'Filler Awareness — Houston', 8, 3);
    generateLeads('mock_camp_3', 'Hydrafacial Retargeting', 6, 4);

    return {
        leads: allLeads,
        byCampaign,
        totalLeads: allLeads.length,
        hasLeadForms: true,
    };
}

// --- Mock Data ---

function getMockData(since: string, until: string): MetaAdsData {
    const start = new Date(since);
    const end = new Date(until);
    const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000));

    // Generate daily spend data
    const dailySpend: MetaDailySpend[] = [];
    for (let i = 0; i < days; i++) {
        const date = new Date(start);
        date.setDate(date.getDate() + i);
        const daySpend = 20 + Math.random() * 40;
        const impressions = Math.round(daySpend * 180 + Math.random() * 500);
        const clicks = Math.round(impressions * (0.012 + Math.random() * 0.008));
        const results = Math.random() > 0.4 ? Math.round(clicks * (0.05 + Math.random() * 0.08)) : 0;
        dailySpend.push({
            date: date.toISOString().split('T')[0],
            spend: Math.round(daySpend * 100) / 100,
            impressions,
            clicks,
            results,
        });
    }

    const totalSpend = dailySpend.reduce((s, d) => s + d.spend, 0);
    const totalImpressions = dailySpend.reduce((s, d) => s + d.impressions, 0);
    const totalClicks = dailySpend.reduce((s, d) => s + d.clicks, 0);
    const totalResults = dailySpend.reduce((s, d) => s + d.results, 0);

    const campaigns: MetaCampaign[] = [
        {
            id: 'mock_camp_1',
            name: 'Botox Special — Spring 2026',
            status: 'ACTIVE',
            objective: 'OUTCOME_LEADS',
            spend: Math.round(totalSpend * 0.45 * 100) / 100,
            impressions: Math.round(totalImpressions * 0.45),
            clicks: Math.round(totalClicks * 0.45),
            reach: Math.round(totalImpressions * 0.38),
            frequency: 1.4,
            cpm: 18.50,
            cpc: 1.62,
            ctr: 1.14,
            results: Math.round(totalResults * 0.5),
            costPerResult: 0,
            roas: 3.2,
            startTime: since,
            stopTime: null,
        },
        {
            id: 'mock_camp_2',
            name: 'Filler Awareness — Houston',
            status: 'ACTIVE',
            objective: 'OUTCOME_AWARENESS',
            spend: Math.round(totalSpend * 0.35 * 100) / 100,
            impressions: Math.round(totalImpressions * 0.35),
            clicks: Math.round(totalClicks * 0.35),
            reach: Math.round(totalImpressions * 0.30),
            frequency: 1.8,
            cpm: 14.20,
            cpc: 2.10,
            ctr: 0.68,
            results: Math.round(totalResults * 0.3),
            costPerResult: 0,
            roas: 2.1,
            startTime: since,
            stopTime: null,
        },
        {
            id: 'mock_camp_3',
            name: 'Hydrafacial Retargeting',
            status: 'PAUSED',
            objective: 'OUTCOME_LEADS',
            spend: Math.round(totalSpend * 0.20 * 100) / 100,
            impressions: Math.round(totalImpressions * 0.20),
            clicks: Math.round(totalClicks * 0.20),
            reach: Math.round(totalImpressions * 0.16),
            frequency: 2.3,
            cpm: 22.80,
            cpc: 1.38,
            ctr: 1.65,
            results: Math.round(totalResults * 0.2),
            costPerResult: 0,
            roas: 4.8,
            startTime: since,
            stopTime: until,
        },
    ];

    // Fill costPerResult
    for (const c of campaigns) {
        c.costPerResult = c.results > 0 ? Math.round((c.spend / c.results) * 100) / 100 : 0;
    }

    return {
        isConfigured: false,
        isMock: true,
        account: {
            id: AD_ACCOUNT_ID,
            name: 'Chin Up! Aesthetics',
            currency: 'USD',
            timezone: 'America/Chicago',
            accountStatus: 1,
            totalSpend: Math.round(totalSpend * 100) / 100,
            totalImpressions,
            totalClicks,
            totalReach: Math.round(totalImpressions * 0.84),
            totalResults,
        },
        campaigns,
        dailySpend,
    };
}

// --- Ad Creatives ---

export interface MetaAdCreative {
    adId: string;
    campaignId: string;
    title: string | null;
    body: string | null;
    linkDescription: string | null;
    thumbnailUrl: string | null;
}

/**
 * Fetch ad creatives (copy text) for all ads in the account.
 * Returns a map of campaignId → array of creatives.
 */
export async function getMetaAdCreatives(
    since: string,
    until: string,
): Promise<Map<string, MetaAdCreative[]>> {
    const cacheKey = `meta_creatives_${since}_${until}`;
    const cached = getCached<Map<string, MetaAdCreative[]>>(cacheKey);
    if (cached) { trackCall('metaAds', 'getAdCreatives', true); return cached; }

    const token = getOptionalEnv('META_ADS_ACCESS_TOKEN');
    if (!token) return new Map();

    const result = new Map<string, MetaAdCreative[]>();

    try {
        // Fetch ads with creative fields — paginated
        let url = `/${AD_ACCOUNT_ID}/ads?fields=id,campaign_id,creative{title,body,link_description,thumbnail_url}&time_range={"since":"${since}","until":"${until}"}&limit=100`;

        while (url) {
            const data = await adsGet<{
                data: Array<{
                    id: string;
                    campaign_id: string;
                    creative?: {
                        title?: string;
                        body?: string;
                        link_description?: string;
                        thumbnail_url?: string;
                    };
                }>;
                paging?: { next?: string };
            }>(url, token);

            for (const ad of data.data || []) {
                const creative: MetaAdCreative = {
                    adId: ad.id,
                    campaignId: ad.campaign_id,
                    title: ad.creative?.title || null,
                    body: ad.creative?.body || null,
                    linkDescription: ad.creative?.link_description || null,
                    thumbnailUrl: ad.creative?.thumbnail_url || null,
                };

                const arr = result.get(ad.campaign_id) || [];
                arr.push(creative);
                result.set(ad.campaign_id, arr);
            }

            // Follow pagination
            if (data.paging?.next) {
                // Extract path from full URL
                url = data.paging.next.replace(`${GRAPH_BASE}`, '');
            } else {
                break;
            }
        }
    } catch (e) {
        console.error('[meta-ads] Failed to fetch ad creatives:', e instanceof Error ? e.message : e);
    }

    setCache(cacheKey, result);
    return result;
}
