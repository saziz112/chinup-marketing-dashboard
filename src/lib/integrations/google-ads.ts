import { pgCached } from '@/lib/pg-cache';
import { trackCall } from '@/lib/api-usage-tracker';
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
    trackCall('googleAds', 'googleAds:search', false);

    if (!res.ok) {
        const errortxt = await res.text();
        throw new Error(`Google Ads API failed: ${errortxt}`);
    }

    const data = await res.json();
    return data.results || [];
}

// --- Cache (matches Meta Ads 4-hour pattern) ---
// Postgres-backed so every serverless instance shares it; the old per-instance
// Map missed on almost every Vercel request.
const GOOGLE_ADS_CACHE_TTL_HOURS = 4;

export async function getGoogleAdsData(since: string, until: string): Promise<GoogleAdsData> {
    if (!isGoogleAdsConfigured()) throw new Error('Google Ads not configured: credentials are missing');

    let fetched = false;
    const data = await pgCached(`google_ads_${since}_${until}`, { ttlHours: GOOGLE_ADS_CACHE_TTL_HOURS }, () => {
        fetched = true;
        return fetchGoogleAdsData(since, until);
    });
    if (!fetched) trackCall('googleAds', 'getGoogleAdsData', true);
    return data;
}

async function fetchGoogleAdsData(since: string, until: string): Promise<GoogleAdsData> {
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
        // 2. Campaign level metrics, 3. daily trend: independent, so all three run together
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
        const [accountRows, campaignRows, dailyRows] = await Promise.all([
            runAdsQuery(accessToken, accountQuery),
            runAdsQuery(accessToken, campaignsQuery),
            runAdsQuery(accessToken, dailyQuery),
        ]);
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
        return result;

    } catch (error: any) {
        console.error('[GoogleAds REST] Live API Error Details:', error.message || error);
        throw error; // uncached; the Ads page shows the error instead of numbers
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
}

// Cache google-sourced lead counts for 30 min (matches strategy/pipeline cache cadence).
// Postgres-backed so the cache holds across serverless instances.
const GHL_GOOGLE_LEADS_TTL_HOURS = 0.5;
const STATUSES = ['open', 'won', 'lost', 'abandoned'] as const;

export async function getGhlGoogleLeads(since: string, until: string): Promise<{
    count: number;
    opportunities: GhlGoogleLead[];
}> {
    const result = await pgCached(`ghl_google_${since}_${until}`, { ttlHours: GHL_GOOGLE_LEADS_TTL_HOURS }, async () => {
        const sinceMs = new Date(since + 'T00:00:00').getTime();
        const untilMs = new Date(until + 'T23:59:59').getTime();

        // Locations have separate API keys, so they run together. Inside a location,
        // pipelines stay sequential and the 4 statuses run together (4 requests in
        // flight per location, same as the pipeline loader). Results are flattened
        // in location -> pipeline -> status order, matching the old sequential loop.
        const perLocation = await Promise.all(getLocations().map(async (loc) => {
            try {
                const matched: GhlGoogleLead[] = [];
                const pipelines = await getPipelines(loc);
                for (const pipeline of pipelines) {
                    // Fetch all statuses so we catch leads regardless of outcome
                    const byStatus = await Promise.all(STATUSES.map(status =>
                        getOpportunities(loc, pipeline.id, { status, maxPages: 10 })));
                    for (const { opportunities } of byStatus) {
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
                            });
                        }
                    }
                }
                return matched;
            } catch (e) {
                // A missing location would read as a real (lower) lead count; fail instead.
                console.warn(`[ghl-google-leads] location ${loc.key} failed:`, e);
                throw e;
            }
        }));

        const matched = perLocation.flat();
        return { count: matched.length, opportunities: matched };
    });

    // enrichGhlLeadsWithMindBody writes onto these objects; hand out copies so a
    // cached entry never carries one request's enrichment into the next.
    return { count: result.count, opportunities: result.opportunities.map(o => ({ ...o })) };
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

    // 1. Pull MindBody email→client map (with revenue summed for the window)
    const emailMap = await getClientEmailMapFromDB(mbStart, mbEnd);
    const matchedClientIds: Array<{ clientId: string; leadDate: string }> = [];

    // 2. Match each GHL lead to a POS client (Zenoti or MindBody history) by email
    for (const lead of leads) {
        const email = (lead.contactEmail || '').toLowerCase().trim();
        if (!email) continue;
        const mb = emailMap.get(email);
        if (mb) {
            const clientId = String(mb.client.Id);
            lead.mbClientId = clientId;
            lead.mbRevenue = mb.revenue;
            matchedClientIds.push({ clientId, leadDate: lead.createdAt.slice(0, 10) });
        }
    }

    // 3. Lookup booked/completed appointments for matched clients
    if (matchedClientIds.length > 0) {
        const apptMap = await getAppointmentsByClientIds(matchedClientIds);
        for (const lead of leads) {
            if (!lead.mbClientId) continue;
            const appts = apptMap.get(lead.mbClientId);
            if (appts) {
                lead.mbBooked = appts.booked;
                lead.mbCompleted = appts.completed;
            }
        }
    }

    // 4. Aggregate totals (no per-campaign breakdown — see function docstring).
    // Matched = the person bought in the window; a $0 client record is not a paying patient.
    // Bookings count PEOPLE, once per client: leads who booked (non-cancelled, on/after
    // their earliest lead date) and leads who showed. Per-lead mbBooked stays a count.
    const matched = leads.filter(l => l.mbRevenue > 0);
    const totalRevenue = matched.reduce((s, l) => s + l.mbRevenue, 0);
    const withClient = [...new Map(leads.filter(l => l.mbClientId).map(l => [l.mbClientId, l])).values()];
    const appointmentsBooked = withClient.filter(l => l.mbBooked > 0).length;
    const appointmentsCompleted = withClient.filter(l => l.mbCompleted > 0).length;
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
