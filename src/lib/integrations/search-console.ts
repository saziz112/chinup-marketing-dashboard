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

function generateMockGscData(days: number): GscData {
    const today = new Date();
    const dailyMetrics: GscDailyMetric[] = [];

    let totalClicks = 0;
    let totalImpressions = 0;
    let sumPosition = 0;

    for (let i = days; i >= 1; i--) {
        const date = format(subDays(today, i), 'yyyy-MM-dd');
        const baseClicks = 15 + Math.floor(Math.random() * 20) + (days - i) * 0.2;
        const baseImpressions = baseClicks * (8 + Math.random() * 10);
        const dayOfWeek = subDays(today, i).getDay();
        const multiplier = (dayOfWeek === 0 || dayOfWeek === 6) ? 0.7 : 1.1;

        const clicks = Math.round(baseClicks * multiplier);
        const impressions = Math.round(baseImpressions * multiplier);
        const ctr = impressions > 0 ? (clicks / impressions) : 0;
        const position = 12 + Math.random() * 8 - (days - i) * 0.05;

        totalClicks += clicks;
        totalImpressions += impressions;
        sumPosition += position;

        dailyMetrics.push({ date, clicks, impressions, ctr, position });
    }

    const avgPosition = sumPosition / days;
    const avgCtr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;

    const mockQueries: GscQuery[] = [
        { query: 'chin up aesthetics', clicks: Math.round(totalClicks * 0.3), impressions: Math.round(totalImpressions * 0.1), ctr: 0.15, position: 1.2 },
        { query: 'med spa near me', clicks: Math.round(totalClicks * 0.15), impressions: Math.round(totalImpressions * 0.3), ctr: 0.03, position: 14.5 },
        { query: 'botox houston', clicks: Math.round(totalClicks * 0.12), impressions: Math.round(totalImpressions * 0.25), ctr: 0.025, position: 18.2 },
    ];

    const mockPages: GscPage[] = [
        { page: 'https://chinupaesthetics.com/', clicks: Math.round(totalClicks * 0.45), impressions: Math.round(totalImpressions * 0.35), ctr: 0.06, position: 15.2 },
        { page: 'https://chinupaesthetics.com/services/injectables', clicks: Math.round(totalClicks * 0.2), impressions: Math.round(totalImpressions * 0.25), ctr: 0.04, position: 18.5 },
    ];

    return {
        period: `${days}d`,
        totals: { clicks: totalClicks, impressions: totalImpressions, ctr: avgCtr, position: avgPosition },
        dailyMetrics,
        topQueries: mockQueries.sort((a, b) => b.clicks - a.clicks),
        topPages: mockPages.sort((a, b) => b.clicks - a.clicks),
        isMock: true,
        isConfigured: false,
    };
}

/**
 * Fetches Google Search Console data.
 */
export async function getSearchConsoleData(periodDays: number = 30): Promise<GscData> {
    const now = Date.now();

    if (cachedData && cachedData.period === `${periodDays}d` && (now - lastFetchTime) < CACHE_DURATION_MS && !cachedData.isMock) {
        return cachedData;
    }

    if (!isGscConfigured()) {
        console.warn('[Search Console] Credentials missing. Returning mock data.');
        return generateMockGscData(periodDays);
    }

    try {
        const authClient = getAuthClient();
        const searchconsole = google.searchconsole({ version: 'v1', auth: authClient });

        const siteUrl = process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL || 'sc-domain:chinupaesthetics.com';
        const endDate = format(subDays(new Date(), 2), 'yyyy-MM-dd'); // GSC data is usually 2 days delayed
        const startDate = format(subDays(new Date(), periodDays + 2), 'yyyy-MM-dd');

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

    } catch (error: any) {
        console.error('[Search Console] API Error:', error.message);
        // Fallback to mock if it's a domain permission error or other setup issue to prevent crash
        return generateMockGscData(periodDays);
    }
}
