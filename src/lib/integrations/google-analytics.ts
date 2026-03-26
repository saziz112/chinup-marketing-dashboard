/**
 * Google Analytics Data API (GA4) integration.
 * Uses the same service account as Search Console.
 *
 * Setup:
 * 1. Enable "Google Analytics Data API" in Google Cloud Console
 * 2. Grant the service account Viewer access on the GA4 property
 * 3. Add GA4_PROPERTY_ID to .env.local (numeric property ID, e.g., "123456789")
 */

import { google } from 'googleapis';

// 4-hour cache
let cachedTrafficData: TrafficSourceData | null = null;
let lastFetchTime = 0;
const CACHE_DURATION_MS = 4 * 60 * 60 * 1000;

export interface TrafficSource {
    source: string;
    medium: string;
    sessions: number;
    users: number;
}

export interface TopPage {
    page: string;
    views: number;
    sessions: number;
}

export interface TrafficSourceData {
    sourceBreakdown: TrafficSource[];
    instagramVisits: number;
    instagramTopPages: TopPage[];
    facebookVisits: number;
    googleVisits: number;
    directVisits: number;
    totalSessions: number;
    period: string;
    isMock: boolean;
}

export function isGA4Configured(): boolean {
    return !!process.env.GA4_PROPERTY_ID && !!process.env.GOOGLE_CLIENT_EMAIL && !!process.env.GOOGLE_PRIVATE_KEY;
}

function getAuthClient() {
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
    const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (!clientEmail || !privateKey) {
        throw new Error('Missing Google Auth credentials');
    }

    return new google.auth.JWT({
        email: clientEmail,
        key: privateKey,
        scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
    });
}

export async function getTrafficSources(days: number = 30): Promise<TrafficSourceData> {
    // Check cache
    if (cachedTrafficData && Date.now() - lastFetchTime < CACHE_DURATION_MS) {
        return cachedTrafficData;
    }

    if (!isGA4Configured()) {
        console.warn('[GA4] Not configured. Set GA4_PROPERTY_ID, GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY.');
        return generateMockData(days);
    }

    const propertyId = process.env.GA4_PROPERTY_ID;
    const auth = getAuthClient();

    try {
        const analyticsData = google.analyticsdata({ version: 'v1beta', auth });
        const propertyStr = `properties/${propertyId}`;

        // Run two reports in parallel:
        // 1. Traffic sources breakdown
        // 2. Instagram-specific landing pages
        const [sourcesReport, igPagesReport] = await Promise.all([
            analyticsData.properties.runReport({
                property: propertyStr,
                requestBody: {
                    dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
                    dimensions: [
                        { name: 'sessionSource' },
                        { name: 'sessionMedium' },
                    ],
                    metrics: [
                        { name: 'sessions' },
                        { name: 'totalUsers' },
                    ],
                    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
                    limit: '20' as any,
                },
            }),
            analyticsData.properties.runReport({
                property: propertyStr,
                requestBody: {
                    dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
                    dimensions: [{ name: 'pagePath' }],
                    metrics: [
                        { name: 'screenPageViews' },
                        { name: 'sessions' },
                    ],
                    dimensionFilter: {
                        filter: {
                            fieldName: 'sessionSource',
                            stringFilter: {
                                matchType: 'CONTAINS' as const,
                                value: 'instagram',
                                caseSensitive: false,
                            },
                        },
                    },
                    orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
                    limit: '10' as any,
                },
            }),
        ]);

        // Parse sources
        const sourceBreakdown: TrafficSource[] = [];
        let instagramVisits = 0;
        let facebookVisits = 0;
        let googleVisits = 0;
        let directVisits = 0;
        let totalSessions = 0;

        for (const row of sourcesReport.data?.rows || []) {
            const source = row.dimensionValues?.[0]?.value || '(not set)';
            const medium = row.dimensionValues?.[1]?.value || '(not set)';
            const sessions = Number(row.metricValues?.[0]?.value || 0);
            const users = Number(row.metricValues?.[1]?.value || 0);

            sourceBreakdown.push({ source, medium, sessions, users });
            totalSessions += sessions;

            const sourceLower = source.toLowerCase();
            if (sourceLower.includes('instagram') || sourceLower === 'l.instagram.com') {
                instagramVisits += sessions;
            } else if (sourceLower.includes('facebook') || sourceLower === 'l.facebook.com' || sourceLower === 'm.facebook.com') {
                facebookVisits += sessions;
            } else if (sourceLower === 'google') {
                googleVisits += sessions;
            } else if (sourceLower === '(direct)') {
                directVisits += sessions;
            }
        }

        // Parse IG landing pages
        const instagramTopPages: TopPage[] = [];
        for (const row of igPagesReport.data?.rows || []) {
            instagramTopPages.push({
                page: row.dimensionValues?.[0]?.value || '/',
                views: Number(row.metricValues?.[0]?.value || 0),
                sessions: Number(row.metricValues?.[1]?.value || 0),
            });
        }

        const data: TrafficSourceData = {
            sourceBreakdown,
            instagramVisits,
            instagramTopPages,
            facebookVisits,
            googleVisits,
            directVisits,
            totalSessions,
            period: `${days} days`,
            isMock: false,
        };

        cachedTrafficData = data;
        lastFetchTime = Date.now();
        return data;
    } catch (error: any) {
        console.error('[GA4] Error fetching data:', error.message);
        // Return mock on error so the page doesn't break
        return generateMockData(days);
    }
}

function generateMockData(days: number): TrafficSourceData {
    return {
        sourceBreakdown: [
            { source: 'google', medium: 'organic', sessions: 1200, users: 980 },
            { source: '(direct)', medium: '(none)', sessions: 450, users: 380 },
            { source: 'instagram', medium: 'referral', sessions: 342, users: 290 },
            { source: 'facebook', medium: 'referral', sessions: 128, users: 105 },
            { source: 'google', medium: 'cpc', sessions: 95, users: 82 },
        ],
        instagramVisits: 342,
        instagramTopPages: [
            { page: '/services/dysport', views: 89, sessions: 72 },
            { page: '/services/lip-filler', views: 67, sessions: 54 },
            { page: '/book', views: 45, sessions: 38 },
            { page: '/', views: 41, sessions: 35 },
            { page: '/services/hydrafacial', views: 28, sessions: 22 },
        ],
        facebookVisits: 128,
        googleVisits: 1295,
        directVisits: 450,
        totalSessions: 2215,
        period: `${days} days`,
        isMock: true,
    };
}
