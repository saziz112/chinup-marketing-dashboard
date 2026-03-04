

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

export async function getGoogleAdsData(since: string, until: string): Promise<GoogleAdsData> {
    if (!isGoogleAdsConfigured()) {
        console.warn('[GoogleAds] Credentials missing, falling back to mock data...');
        return getMockData(since, until);
    }

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

        return {
            isConfigured: true,
            isMock: false,
            account: accountSummary,
            campaigns,
            dailySpend
        };

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

function getMockData(since: string, until: string): GoogleAdsData {
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
