import { subDays, format } from 'date-fns';
import { google } from 'googleapis';

export interface GscDailyMetric {
    date: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
}

export interface GscQuery {
    query: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
}

export interface GscPage {
    page: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
}

export interface GscData {
    period: string; // e.g., '30d'
    totals: {
        clicks: number;
        impressions: number;
        ctr: number;
        position: number;
    };
    dailyMetrics: GscDailyMetric[];
    topQueries: GscQuery[];
    topPages: GscPage[];
    isMock: boolean;
    isConfigured: boolean;
}

// In-memory cache
let cachedData: GscData | null = null;
let lastFetchTime: number = 0;
const CACHE_DURATION_MS = 4 * 60 * 60 * 1000; // 4 hours

export function isGscConfigured(): boolean {
    return !!process.env.GOOGLE_CLIENT_EMAIL && !!process.env.GOOGLE_PRIVATE_KEY;
}

function getAuthClient() {
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
    const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (!clientEmail || !privateKey) {
        throw new Error('Missing Google Auth credentials in environment variables.');
    }

    return new google.auth.JWT({
        email: clientEmail,
        key: privateKey,
        scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
    });
}

/**
 * Fetches Google Search Console data.
 */
export async function getSearchConsoleData(periodDays: number = 30): Promise<GscData> {
    const now = Date.now();

    if (cachedData && cachedData.period === `${periodDays}d` && (now - lastFetchTime) < CACHE_DURATION_MS) {
        return cachedData;
    }

    if (!isGscConfigured()) {
        throw new Error('Search Console not configured: GOOGLE_CLIENT_EMAIL or GOOGLE_PRIVATE_KEY is missing');
    }

    // Errors propagate uncached; the caller shows an error instead of a number.
    const authClient = getAuthClient();
    const searchconsole = google.searchconsole({ version: 'v1', auth: authClient });

    const siteUrl = process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL || 'sc-domain:chinupaesthetics.com';
    const endDate = format(subDays(new Date(), 2), 'yyyy-MM-dd'); // GSC data is usually 2 days delayed
    const startDate = format(subDays(new Date(), periodDays + 1), 'yyyy-MM-dd'); // inclusive: exactly periodDays days

    console.log(`[Search Console] Fetching live data for ${siteUrl} (${startDate} to ${endDate})`);

    // 1. Fetch Totals and Daily Metrics (Group by date)
    const dailyReq = await searchconsole.searchanalytics.query({
        siteUrl,
        requestBody: {
            startDate,
            endDate,
            dimensions: ['date'],
            rowLimit: 1000,
        },
    });

    const dailyRows = dailyReq.data.rows || [];
    let totalClicks = 0;
    let totalImpressions = 0;
    let sumPosition = 0;

    const dailyMetrics: GscDailyMetric[] = dailyRows.map(row => {
        const clicks = row.clicks || 0;
        const impressions = row.impressions || 0;
        const position = row.position || 0;

        totalClicks += clicks;
        totalImpressions += impressions;
        sumPosition += position * impressions; // Weight position by impressions for true average

        return {
            date: row.keys?.[0] || '',
            clicks,
            impressions,
            ctr: row.ctr || 0,
            position,
        };
    }).sort((a, b) => a.date.localeCompare(b.date));

    const avgPosition = totalImpressions > 0 ? sumPosition / totalImpressions : 0;
    const avgCtr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;

    // 2. Fetch Top Queries
    const queriesReq = await searchconsole.searchanalytics.query({
        siteUrl,
        requestBody: {
            startDate,
            endDate,
            dimensions: ['query'],
            rowLimit: 50,
        },
    });

    const topQueries: GscQuery[] = (queriesReq.data.rows || []).map(row => ({
        query: row.keys?.[0] || 'Unknown',
        clicks: row.clicks || 0,
        impressions: row.impressions || 0,
        ctr: row.ctr || 0,
        position: row.position || 0,
    }));

    // 3. Fetch Top Pages
    const pagesReq = await searchconsole.searchanalytics.query({
        siteUrl,
        requestBody: {
            startDate,
            endDate,
            dimensions: ['page'],
            rowLimit: 50,
        },
    });

    const topPages: GscPage[] = (pagesReq.data.rows || []).map(row => ({
        page: row.keys?.[0] || 'Unknown',
        clicks: row.clicks || 0,
        impressions: row.impressions || 0,
        ctr: row.ctr || 0,
        position: row.position || 0,
    }));

    const result: GscData = {
        period: `${periodDays}d`,
        totals: {
            clicks: totalClicks,
            impressions: totalImpressions,
            ctr: avgCtr,
            position: avgPosition,
        },
        dailyMetrics,
        topQueries,
        topPages,
        isMock: false,
        isConfigured: true,
    };

    cachedData = result;
    lastFetchTime = now;
    return result;
}
