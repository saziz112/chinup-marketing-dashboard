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
 * When not configured or when the API fails, throws: callers show an error, never a number.
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

// Fetches every page of a Graph list endpoint. `url` is a full URL including the token;
// Meta's paging.next links carry the token, so they are followed as-is.
async function graphGetAll<T>(url: string, label: string): Promise<T[]> {
    const rows: T[] = [];
    let next: string | undefined = url;
    while (next) {
        const response = await fetch(next);
        trackCall('metaAds', label, false);
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(`Meta API error: ${response.status} ${label} — ${JSON.stringify(err)}`);
        }
        const page = await response.json() as { data?: T[]; paging?: { next?: string } };
        rows.push(...(page.data || []));
        next = page.paging?.next;
    }
    return rows;
}

// A "result" is a lead. Link clicks are never counted as leads.
function getLeadCount(actions: Array<{ action_type: string; value: string }> | undefined): number {
    const get = (type: string) => parseFloat(actions?.find(a => a.action_type === type)?.value || '0');
    return get('lead') || get('onsite_conversion.lead_grouped') || get('offsite_conversion.fb_pixel_lead');
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

    const results = getLeadCount(d.actions);

    // Cost per lead; 0 when the window has no leads
    const costPerResult = results > 0
        ? (getAction(d.cost_per_action_type, 'lead') || spend / results)
        : 0;

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
    // time_range must sit on the insights field itself; a top-level time_range does not
    // reach the nested expansion, and Meta silently falls back to last_30d.
    const campaigns = await graphGetAll<{
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
    }>(
        `${GRAPH_BASE}/${AD_ACCOUNT_ID}/campaigns?fields=id,name,status,objective,start_time,stop_time,insights.time_range({"since":"${since}","until":"${until}"}){spend,impressions,clicks,reach,frequency,cpm,cpc,ctr,actions,cost_per_action_type,action_values}&limit=100&access_token=${token}`,
        '/campaigns'
    );

    return campaigns.map(c => {
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
    const rows = await graphGetAll<{
        spend?: string;
        impressions?: string;
        clicks?: string;
        actions?: Array<{ action_type: string; value: string }>;
        date_start: string;
    }>(
        `${GRAPH_BASE}/${AD_ACCOUNT_ID}/insights?fields=spend,impressions,clicks,actions&time_increment=1&time_range={"since":"${since}","until":"${until}"}&access_token=${token}`,
        '/insights(daily)'
    );

    return rows.map(d => {
        const results = getLeadCount(d.actions);
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
    if (!token) throw new Error('Meta Ads not configured: META_ADS_ACCESS_TOKEN is missing');

    // Errors propagate uncached, so a fixed token takes effect on the next request.
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
        throw new Error('Meta lead forms not configured: META_PAGE_ACCESS_TOKEN or META_PAGE_ID is missing');
    }

    // Fetch all lead gen forms from the page (requires page token, NOT ads token)
    const forms = await graphGetAll<{ id: string; name: string; leads_count?: number }>(
        `${GRAPH_BASE}/${pageId}/leadgen_forms?fields=id,name,leads_count&limit=100&access_token=${pageToken}`,
        '/leadgen_forms'
    );

    if (!forms.length) {
        return { leads: [], byCampaign: new Map(), totalLeads: 0, hasLeadForms: false };
    }

    // Filter to forms that actually have leads
    const formsWithLeads = forms.filter(f => (f.leads_count || 0) > 0);
    if (!formsWithLeads.length) {
        // Forms exist but no leads yet
        return { leads: [], byCampaign: new Map(), totalLeads: 0, hasLeadForms: true };
    }

    // Date filter as Unix timestamps
    const sinceTs = Math.floor(new Date(since).getTime() / 1000);
    const untilTs = Math.floor(new Date(until + 'T23:59:59').getTime() / 1000);

    const allLeads: MetaLead[] = [];
    const byCampaign = new Map<string, MetaLead[]>();

    // Fetch leads from each form (page token required). One failed form fails the
    // whole call: a partial count would read as a real (low) number.
    await Promise.all(formsWithLeads.map(async form => {
        const filterStr = encodeURIComponent(JSON.stringify([
            { field: 'time_created', operator: 'GREATER_THAN', value: sinceTs },
            { field: 'time_created', operator: 'LESS_THAN', value: untilTs },
        ]));
        const leadsUrl = `${GRAPH_BASE}/${form.id}/leads` +
            `?fields=id,created_time,ad_id,campaign_id,campaign_name,field_data` +
            `&filtering=${filterStr}` +
            `&limit=500` +
            `&access_token=${pageToken}`;
        const rawLeads = await graphGetAll<{
            id: string;
            created_time: string;
            ad_id?: string;
            campaign_id?: string;
            campaign_name?: string;
            field_data: RawLeadFieldData[];
        }>(leadsUrl, '/form/leads');

        for (const raw of rawLeads) {
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
    }));

    const result = {
        leads: allLeads,
        byCampaign,
        totalLeads: allLeads.length,
        hasLeadForms: true,
    };
    setCache(cacheKey, result);
    return result;
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
