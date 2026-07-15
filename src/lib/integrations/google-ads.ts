import { createMemCache } from '@/lib/mem-cache';
import { getLocations, getPipelines, getOpportunities } from './gohighlevel';
import { getClientEmailMapFromDB, getAppointmentsByClientIds } from './mindbody-db';

export interface GoogleAdsData {
    isConfigured: boolean;
    isMock: boolean;
    account: GoogleAccountSummary;
    campaigns: GoogleCampaign[];
    dailySpend: GoogleDailySpend[];
}

export interface GoogleAccountSummary {
    id: string;
    name: string;
    currency: string;
    timezone: string;
    accountStatus: number;
    totalSpend: number;
    totalImpressions: number;
    totalClicks: number;
    totalResults: number;
}

export interface GoogleCampaign {
    id: string;
    name: string;
    status: 'ACTIVE' | 'PAUSED' | 'DELETED' | 'ARCHIVED';
    objective: string;
    spend: number;
    impressions: number;
    clicks: number;
    cpm: number;
    cpc: number;
    ctr: number;
    results: number;
    costPerResult: number;
    roas: number;
    startTime: string;
    stopTime: string | null;
}

export interface GoogleDailySpend {
    date: string;
    spend: number;
    impressions: number;
    clicks: number;
    results: number;
}

export function isGoogleAdsConfigured(): boolean {
    return Boolean(
        process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID &&
        process.env.GOOGLE_ADS_CUSTOMER_ID &&
        process.env.GOOGLE_ADS_DEVELOPER_TOKEN &&
        process.env.GOOGLE_ADS_CLIENT_ID &&
        process.env.GOOGLE_ADS_CLIENT_SECRET &&
        process.env.GOOGLE_ADS_REFRESH_TOKEN
    );
}

function mapCampaignStatus(statusEnum: string): 'ACTIVE' | 'PAUSED' | 'DELETED' | 'ARCHIVED' {
    switch (statusEnum) {
        case 'ENABLED': return 'ACTIVE';
        case 'PAUSED': return 'PAUSED';
        case 'REMOVED': return 'DELETED';
        default: return 'ARCHIVED';
    }
}

async function getAccessToken(): Promise<string> {
    const params = new URLSearchParams({
        client_id: process.env.GOOGLE_ADS_CLIENT_ID!,
        client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET!,
        refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN!,
        grant_type: 'refresh_token'
    });

    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        cache: 'no-store'
    });

    if (!res.ok) {
        throw new Error(`Failed to fetch access token: ${await res.text()}`);
    }

    const data = await res.json();
    return data.access_token;
}

async function runAdsQuery(accessToken: string, query: string): Promise<any[]> {
    const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID!;
    const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID!;
    const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN!;

    const url = `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:search`;

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'developer-token': developerToken,
            'login-customer-id': loginCustomerId,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query }),
        cache: 'no-store'
    });

    if (!res.ok) {
        const errortxt = await res.text();
        throw new Error(`Google Ads API failed: ${errortxt}`);
    }

    const data = await res.json();
    return data.results || [];
}

// --- Cache (matches Meta Ads 4-hour pattern) ---
const googleAdsCache = createMemCache<GoogleAdsData>(4 * 60 * 60 * 1000); // 4 hours

export async function getGoogleAdsData(since: string, until: string): Promise<GoogleAdsData> {
    if (!isGoogleAdsConfigured()) {
        console.warn('[GoogleAds] Credentials missing, falling back to mock data...');
        return getMockData(since, until);
    }

    // Check cache first
    const cacheKey = `google_ads_${since}_${until}`;
    const cached = googleAdsCache.get(cacheKey);
    if (cached) return cached;

    try {
        console.log(`[GoogleAds REST] Fetching live data... Customer: ${process.env.GOOGLE_ADS_CUSTOMER_ID}`);
        const accessToken = await getAccessToken();

        // 1. Fetch Account Summary
        const accountQuery = `
            SELECT 
                customer.id, 
                customer.descriptive_name,
                customer.currency_code,
                customer.time_zone,
                metrics.cost_micros,
                metrics.impressions,
                metrics.clicks,
                metrics.conversions
            FROM customer 
            WHERE segments.date >= '${since}' AND segments.date <= '${until}'
        `;
        const accountRows = await runAdsQuery(accessToken, accountQuery);
        const accountRow = accountRows[0] || {};

        const totalSpend = (parseInt(accountRow.metrics?.costMicros) || 0) / 1000000;
        const totalImpressions = parseInt(accountRow.metrics?.impressions || '0');
        const totalClicks = parseInt(accountRow.metrics?.clicks || '0');
        const totalResults = parseFloat(accountRow.metrics?.conversions || '0');

        const accountSummary: GoogleAccountSummary = {
            id: accountRow.customer?.id?.toString() || process.env.GOOGLE_ADS_CUSTOMER_ID!,
            name: accountRow.customer?.descriptiveName || 'Chin Up Aesthetics',
            currency: accountRow.customer?.currencyCode || 'USD',
            timezone: accountRow.customer?.timeZone || 'America/Chicago',
            accountStatus: 1,
            totalSpend: Number(totalSpend.toFixed(2)),
            totalImpressions,
            totalClicks,
            totalResults: Math.round(totalResults)
        };

        // 2. Fetch Campaign Level Metrics
        const campaignsQuery = `
            SELECT 
                campaign.id,
                campaign.name,
                campaign.status,
                campaign.advertising_channel_type,
                campaign.start_date_time,
                campaign.end_date_time,
                metrics.cost_micros,
                metrics.impressions,
                metrics.clicks,
                metrics.conversions,
                metrics.conversions_value
            FROM campaign 
            WHERE metrics.impressions > 0 
            AND segments.date >= '${since}' AND segments.date <= '${until}'
        `;
        const campaignRows = await runAdsQuery(accessToken, campaignsQuery);

        const campaigns: GoogleCampaign[] = campaignRows.map((row: any) => {
            const spend = (parseInt(row.metrics?.costMicros) || 0) / 1000000;
            const impressions = parseInt(row.metrics?.impressions || '0');
            const clicks = parseInt(row.metrics?.clicks || '0');
            const results = parseFloat(row.metrics?.conversions || '0');
            const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
            const cpc = clicks > 0 ? spend / clicks : 0;
            const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
            const costPerResult = results > 0 ? spend / results : 0;
            const conversionValue = parseFloat(row.metrics?.conversionsValue || '0');
            const roas = spend > 0 ? conversionValue / spend : 0;

            return {
                id: row.campaign?.id?.toString() || 'unknown',
                name: row.campaign?.name || 'Unknown Campaign',
                status: mapCampaignStatus(row.campaign?.status),
                objective: row.campaign?.advertisingChannelType || 'SEARCH',
                spend: Number(spend.toFixed(2)),
                impressions,
                clicks,
                cpm: Number(cpm.toFixed(2)),
                cpc: Number(cpc.toFixed(2)),
                ctr: Number(ctr.toFixed(2)),
                results: Math.round(results),
                costPerResult: Number(costPerResult.toFixed(2)),
                roas: Number(roas.toFixed(2)),
                startTime: row.campaign?.startDateTime || '2026-01-01',
                stopTime: row.campaign?.endDateTime || null
            };
        });

        // 3. Fetch Daily Spend Trend
        const dailyQuery = `
            SELECT 
                segments.date,
                metrics.cost_micros,
                metrics.impressions,
                metrics.clicks,
                metrics.conversions
            FROM customer 
            WHERE segments.date >= '${since}' AND segments.date <= '${until}'
            ORDER BY segments.date ASC
        `;
        const dailyRows = await runAdsQuery(accessToken, dailyQuery);

        const dailySpend: GoogleDailySpend[] = dailyRows.map((row: any) => ({
            date: row.segments?.date,
            spend: Number(((parseInt(row.metrics?.costMicros) || 0) / 1000000).toFixed(2)),
            impressions: parseInt(row.metrics?.impressions || '0'),
            clicks: parseInt(row.metrics?.clicks || '0'),
            results: parseFloat(row.metrics?.conversions || '0')
        }));

        const result: GoogleAdsData = {
            isConfigured: true,
            isMock: false,
            account: accountSummary,
            campaigns,
            dailySpend
        };
        googleAdsCache.set(cacheKey, result);
        return result;

    } catch (error: any) {
        console.error('[GoogleAds REST] Live API Error Details:', error.message || error);

        // Return Mock if API fails to prevent dashboard UI break
        const mock = getMockData(since, until);
        return {
            ...mock,
            isConfigured: true,
            isMock: true
        };
    }
}

export interface GhlGoogleLead {
    id: string;
    name: string;
    source: string;
    createdAt: string;
    status: string;
    locationKey: string;
    contactId: string;
    contactName: string;
    contactEmail: string;
    monetaryValue: number;
    ghlUrl: string | null;
    // MindBody enrichment (populated by enrichGhlLeadsWithMindBody)
    mbClientId: string | null;
    mbRevenue: number;
    mbBooked: number;
    mbCompleted: number;
    mbUrl: string | null;
}

// Cache google-sourced lead counts for 30 min (matches strategy/pipeline cache cadence)
const ghlGoogleLeadsCache = createMemCache<{ count: number; opportunities: GhlGoogleLead[] }>(30 * 60 * 1000);

export async function getGhlGoogleLeads(since: string, until: string): Promise<{
    count: number;
    opportunities: GhlGoogleLead[];
}> {
    const cacheKey = `ghl_google_${since}_${until}`;
    const cached = ghlGoogleLeadsCache.get(cacheKey);
    if (cached) return cached;

    const sinceMs = new Date(since + 'T00:00:00').getTime();
    const untilMs = new Date(until + 'T23:59:59').getTime();
    const matched: GhlGoogleLead[] = [];

    try {
        const locations = getLocations();
        for (const loc of locations) {
            try {
                const pipelines = await getPipelines(loc);
                for (const pipeline of pipelines) {
                    // Fetch all statuses so we catch leads regardless of outcome
                    for (const status of ['open', 'won', 'lost', 'abandoned'] as const) {
                        const { opportunities } = await getOpportunities(loc, pipeline.id, { status, maxPages: 10 });
                        for (const opp of opportunities) {
                            // Catch Google-attributed leads three ways:
                            //  (1) source contains "google" (e.g. "Google Ads - General Medspa Form")
                            //  (2) opportunity name contains "Google Ad" (landing-page leads where
                            //      GHL tagged source as "Website" but the name preserves attribution)
                            //  (3) source mentions "ppc" / "paid" (rarely used)
                            const src = opp.source || '';
                            const nm = opp.name || '';
                            const isGoogle = /google/i.test(src) || /\bgoogle\s*ads?\b/i.test(nm);
                            if (!isGoogle) continue;
                            const created = opp.createdAt ? new Date(opp.createdAt).getTime() : 0;
                            if (created < sinceMs || created > untilMs) continue;
                            const ghlUrl = opp.contactId
                                ? `https://app.gohighlevel.com/v2/location/${loc.locationId}/contacts/detail/${opp.contactId}`
                                : null;
                            matched.push({
                                id: opp.id,
                                name: opp.name,
                                source: opp.source,
                                createdAt: opp.createdAt,
                                status: opp.status,
                                locationKey: loc.key,
                                contactId: opp.contactId,
                                contactName: opp.contactName,
                                contactEmail: opp.contactEmail,
                                monetaryValue: opp.monetaryValue,
                                ghlUrl,
                                mbClientId: null,
                                mbRevenue: 0,
                                mbBooked: 0,
                                mbCompleted: 0,
                                mbUrl: null,
                            });
                        }
                    }
                }
            } catch (e) {
                console.warn(`[ghl-google-leads] location ${loc.key} failed:`, e);
            }
        }
    } catch (e) {
        console.warn('[ghl-google-leads] fatal:', e);
    }

    const result = { count: matched.length, opportunities: matched };
    ghlGoogleLeadsCache.set(cacheKey, result);
    return result;
}

/**
 * Enrich GHL Google leads with MindBody revenue + appointments by email match.
 *
 * Mirrors the Facebook ROAS pattern (lib/integrations/meta-ads.ts → /api/paid-ads/roas):
 *   - For each GHL Google-sourced opportunity, look up the contact's email
 *     in mb_clients_cache → get the MindBody client + sale revenue for the
 *     window
 *   - For each matched client, count booked/completed appointments
 *
 * Returns the enriched leads PLUS totals. Per-campaign breakdown is intentionally
 * NOT computed — GHL doesn't preserve which Google campaign drove each lead, so
 * we only report TOTAL Google ROAS, the same way Facebook reports True ROAS at
 * the account level when individual lead→campaign mapping isn't reliable.
 */
export async function enrichGhlLeadsWithMindBody(
    leads: GhlGoogleLead[],
    since: string,
    until: string,
): Promise<{
    leads: GhlGoogleLead[];
    totals: {
        totalLeads: number;
        mbMatchedClients: number;
        mbMatchRate: number | null;
        totalRevenue: number;
        appointmentsBooked: number;
        appointmentsCompleted: number;
    };
}> {
    const mbStart = `${since}T00:00:00`;
    const mbEnd = `${until}T23:59:59`;
    const mbSiteId = process.env.MINDBODY_SITE_ID || '';

    // 1. Pull MindBody email→client map (with revenue summed for the window)
    const emailMap = await getClientEmailMapFromDB(mbStart, mbEnd).catch(() => new Map());
    const matchedClientIds: string[] = [];

    // 2. Match each GHL lead to a POS client (Zenoti or MindBody history) by email
    for (const lead of leads) {
        const email = (lead.contactEmail || '').toLowerCase().trim();
        if (!email) continue;
        const mb = emailMap.get(email);
        if (mb) {
            const clientId = String(mb.client.Id);
            lead.mbClientId = clientId;
            lead.mbRevenue = mb.revenue;
            // Deep-link only works for legacy numeric MindBody IDs; Zenoti GUIDs have no admin URL here
            lead.mbUrl = mbSiteId && /^\d+$/.test(clientId)
                ? `https://clients.mindbodyonline.com/Asp/adm/adm_clt_personal.asp?clientID=${clientId}&studioid=${mbSiteId}`
                : null;
            matchedClientIds.push(clientId);
        }
    }

    // 3. Lookup booked/completed appointments for matched clients
    if (matchedClientIds.length > 0) {
        try {
            const apptMap = await getAppointmentsByClientIds([...new Set(matchedClientIds)], mbStart, mbEnd);
            for (const lead of leads) {
                if (!lead.mbClientId) continue;
                const appts = apptMap.get(lead.mbClientId);
                if (appts) {
                    lead.mbBooked = appts.booked;
                    lead.mbCompleted = appts.completed;
                }
            }
        } catch (e) {
            console.warn('[google-ads enrich] appts lookup failed:', e);
        }
    }

    // 4. Aggregate totals (no per-campaign breakdown — see function docstring)
    const matched = leads.filter(l => !!l.mbClientId);
    const totalRevenue = matched.reduce((s, l) => s + l.mbRevenue, 0);
    const appointmentsBooked = matched.reduce((s, l) => s + l.mbBooked, 0);
    const appointmentsCompleted = matched.reduce((s, l) => s + l.mbCompleted, 0);
    const totals = {
        totalLeads: leads.length,
        mbMatchedClients: matched.length,
        mbMatchRate: leads.length > 0 ? Math.round((matched.length / leads.length) * 100) : null,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        appointmentsBooked,
        appointmentsCompleted,
    };

    return { leads, totals };
}

function getMockData(_since: string, _until: string): GoogleAdsData {
    return {
        isConfigured: false,
        isMock: true,
        account: {
            id: '123-456-7890',
            name: 'Chin Up Google Ads',
            currency: 'USD',
            timezone: 'America/Chicago',
            accountStatus: 1,
            totalSpend: 1500.00,
            totalImpressions: 5000,
            totalClicks: 250,
            totalResults: 15
        },
        campaigns: [
            {
                id: 'mock_gAds_1',
                name: 'Search - Local Med Spa',
                status: 'ACTIVE',
                objective: 'SEARCH',
                spend: 750.00,
                impressions: 2500,
                clicks: 125,
                cpm: 65.40,
                cpc: 3.20,
                ctr: 4.8,
                results: 10,
                costPerResult: 75.00,
                roas: 4.1,
                startTime: '2026-02-01',
                stopTime: null
            }
        ],
        dailySpend: []
    };
}
