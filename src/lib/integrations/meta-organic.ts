/**
 * Meta Graph API Client — Instagram + Facebook Organic
 * Uses a never-expiring Page Access Token for both IG + FB data.
 * API Version: v22.0 (current as of 2026)
 */

import { trackCall } from '@/lib/api-usage-tracker';
import { LocationId } from './google-business';

// --- Types ---

export interface IGProfile {
    id: string;
    name: string;
    username: string;
    biography: string;
    followersCount: number;
    mediaCount: number;
    profilePictureUrl: string;
}

export interface IGInsightsDay {
    date: string; // YYYY-MM-DD
    reach: number;
    followerCount: number; // net change
}

export interface IGInsightsTotals {
    profileViews: number;
    accountsEngaged: number;
    totalInteractions: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
    views: number;
}

export interface IGMedia {
    id: string;
    caption: string;
    mediaType: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
    mediaUrl: string;
    permalink: string;
    timestamp: string;
    likeCount: number;
    commentsCount: number;
    // Insights (fetched separately)
    views?: number;
    reach?: number;
    shares?: number;
    saved?: number;
    totalInteractions?: number;
    plays?: number; // reels only
    avgWatchTime?: number; // reels only
}

export interface FBPageInfo {
    id: string;
    name: string;
    fanCount: number;
    followersCount: number;
    link: string;
    picture: string;
}

export interface FBInsightsDay {
    date: string;
    pageFollows: number;       // cumulative follower count
    pageViewsTotal: number;
    pagePostEngagements: number;
    pageVideoViews: number;
}

// --- Helpers ---

const GRAPH_API_VERSION = 'v22.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

function getEnv(key: string): string {
    const val = process.env[key];
    if (!val) throw new Error(`Missing env var: ${key}`);
    return val;
}

function getOptionalEnv(key: string): string | null {
    return process.env[key] || null;
}

/**
 * Check if Meta integration is configured (tokens present).
 */
export function isMetaConfigured(): boolean {
    return !!(
        getOptionalEnv('META_PAGE_ACCESS_TOKEN') &&
        getOptionalEnv('META_IG_USER_ID')
    );
}

async function graphGet<T>(endpoint: string, token: string): Promise<T> {
    const url = `${GRAPH_BASE}${endpoint}${endpoint.includes('?') ? '&' : '?'}access_token=${token}`;
    const response = await fetch(url);
    trackCall('meta', endpoint.split('?')[0], false);

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(
            `Meta Graph API error: ${response.status} ${endpoint} — ${JSON.stringify(err)}`
        );
    }

    return response.json() as Promise<T>;
}

// --- In-Memory Cache (4-hour TTL, same pattern as MindBody) ---

const metaCache = new Map<string, { data: unknown; expiresAt: number }>();
const CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

function getCached<T>(key: string): T | null {
    const entry = metaCache.get(key);
    if (entry && Date.now() < entry.expiresAt) {
        return entry.data as T;
    }
    return null;
}

function setCache(key: string, data: unknown): void {
    metaCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL });
}

// --- Instagram Graph API ---

/**
 * Get Instagram Business Account profile info.
 */
export async function getIGProfile(): Promise<IGProfile> {
    const cached = getCached<IGProfile>('ig_profile');
    if (cached) { trackCall('meta', 'getIGProfile', true); return cached; }

    const token = getEnv('META_PAGE_ACCESS_TOKEN');
    const igUserId = getEnv('META_IG_USER_ID');

    const data = await graphGet<{
        id: string;
        name: string;
        username: string;
        biography: string;
        followers_count: number;
        media_count: number;
        profile_picture_url: string;
    }>(
        `/${igUserId}?fields=id,name,username,biography,followers_count,media_count,profile_picture_url`,
        token
    );

    const profile: IGProfile = {
        id: data.id,
        name: data.name,
        username: data.username,
        biography: data.biography || '',
        followersCount: data.followers_count,
        mediaCount: data.media_count,
        profilePictureUrl: data.profile_picture_url || '',
    };

    setCache('ig_profile', profile);
    return profile;
}

/**
 * Get Instagram account-level insights for a date range.
 * Two separate API calls required:
 *   1. Daily metrics (reach, follower_count) — period=day, returns per-day values
 *   2. Aggregate metrics (views, interactions, etc.) — metric_type=total_value, returns totals
 */
export async function getIGInsights(
    since: string,
    until: string
): Promise<{ daily: IGInsightsDay[]; totals: IGInsightsTotals }> {
    const cacheKey = `ig_insights_${since}_${until}`;
    const cached = getCached<{ daily: IGInsightsDay[]; totals: IGInsightsTotals }>(cacheKey);
    if (cached) { trackCall('meta', 'getIGInsights', true); return cached; }

    const token = getEnv('META_PAGE_ACCESS_TOKEN');
    const igUserId = getEnv('META_IG_USER_ID');

    // follower_count only supports since within 30 days of today.
    // If range exceeds that, cap the daily call.
    const today = new Date();
    const sinceDate = new Date(since);
    const daysSinceToday = Math.ceil((today.getTime() - sinceDate.getTime()) / (1000 * 60 * 60 * 24));
    const cappedSince = daysSinceToday > 30
        ? new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        : since;

    // Call 1: Daily breakdown metrics (period=day) — capped to 30 days for follower_count
    const dailyData = await graphGet<{
        data: Array<{
            name: string;
            values: Array<{ value: number; end_time: string }>;
        }>;
    }>(
        `/${igUserId}/insights?metric=reach,follower_count&period=day&since=${cappedSince}&until=${until}`,
        token
    );

    // Call 2: Aggregate totals (metric_type=total_value)
    const totalsData = await graphGet<{
        data: Array<{
            name: string;
            total_value: { value: number };
        }>;
    }>(
        `/${igUserId}/insights?metric=profile_views,accounts_engaged,total_interactions,likes,comments,shares,saves,views&metric_type=total_value&period=day&since=${since}&until=${until}`,
        token
    );

    // Build daily array from call 1
    const dayMap = new Map<string, Partial<IGInsightsDay>>();
    for (const metric of dailyData.data || []) {
        for (const val of metric.values || []) {
            const date = val.end_time.split('T')[0];
            if (!dayMap.has(date)) dayMap.set(date, { date });
            const day = dayMap.get(date)!;
            switch (metric.name) {
                case 'reach': day.reach = val.value; break;
                case 'follower_count': day.followerCount = val.value; break;
            }
        }
    }

    const daily: IGInsightsDay[] = Array.from(dayMap.values())
        .map(d => ({
            date: d.date || '',
            reach: d.reach || 0,
            followerCount: d.followerCount || 0,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

    // Build totals from call 2
    const totals: IGInsightsTotals = {
        profileViews: 0, accountsEngaged: 0, totalInteractions: 0,
        likes: 0, comments: 0, shares: 0, saves: 0, views: 0,
    };
    for (const metric of totalsData.data || []) {
        const v = metric.total_value?.value || 0;
        switch (metric.name) {
            case 'profile_views': totals.profileViews = v; break;
            case 'accounts_engaged': totals.accountsEngaged = v; break;
            case 'total_interactions': totals.totalInteractions = v; break;
            case 'likes': totals.likes = v; break;
            case 'comments': totals.comments = v; break;
            case 'shares': totals.shares = v; break;
            case 'saves': totals.saves = v; break;
            case 'views': totals.views = v; break;
        }
    }

    const result = { daily, totals };
    setCache(cacheKey, result);
    return result;
}

/**
 * Get recent Instagram posts with engagement metrics.
 */
export async function getIGMedia(limit: number = 25): Promise<IGMedia[]> {
    const cacheKey = `ig_media_${limit}`;
    const cached = getCached<IGMedia[]>(cacheKey);
    if (cached) { trackCall('meta', 'getIGMedia', true); return cached; }

    const token = getEnv('META_PAGE_ACCESS_TOKEN');
    const igUserId = getEnv('META_IG_USER_ID');

    // Step 1: Get media list
    const mediaData = await graphGet<{
        data: Array<{
            id: string;
            caption: string;
            media_type: string;
            media_url: string;
            permalink: string;
            timestamp: string;
            like_count: number;
            comments_count: number;
        }>;
    }>(
        `/${igUserId}/media?fields=id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count&limit=${limit}`,
        token
    );

    const posts: IGMedia[] = [];

    for (const m of mediaData.data || []) {
        const post: IGMedia = {
            id: m.id,
            caption: m.caption || '',
            mediaType: m.media_type as IGMedia['mediaType'],
            mediaUrl: m.media_url || '',
            permalink: m.permalink || '',
            timestamp: m.timestamp,
            likeCount: m.like_count || 0,
            commentsCount: m.comments_count || 0,
        };

        // Step 2: Fetch insights per post
        try {
            const isReel = m.media_type === 'VIDEO';
            const postMetrics = isReel
                ? 'views,reach,likes,comments,shares,saved,total_interactions,plays,ig_reels_avg_watch_time'
                : 'views,reach,likes,comments,shares,saved,total_interactions';

            const insightsData = await graphGet<{
                data: Array<{ name: string; values: Array<{ value: number }> }>;
            }>(
                `/${m.id}/insights?metric=${postMetrics}`,
                token
            );

            for (const metric of insightsData.data || []) {
                const value = metric.values?.[0]?.value || 0;
                switch (metric.name) {
                    case 'views': post.views = value; break;
                    case 'reach': post.reach = value; break;
                    case 'shares': post.shares = value; break;
                    case 'saved': post.saved = value; break;
                    case 'total_interactions': post.totalInteractions = value; break;
                    case 'plays': post.plays = value; break;
                    case 'ig_reels_avg_watch_time': post.avgWatchTime = value; break;
                }
            }
        } catch {
            // Insights may fail for very new posts or stories — continue
        }

        posts.push(post);
    }

    setCache(cacheKey, posts);
    return posts;
}

// --- Facebook Page Insights ---

/**
 * Get Facebook Page basic info.
 */
export async function getFBPageInfo(): Promise<FBPageInfo> {
    const cached = getCached<FBPageInfo>('fb_page_info');
    if (cached) { trackCall('meta', 'getFBPageInfo', true); return cached; }

    const token = getEnv('META_PAGE_ACCESS_TOKEN');
    const pageId = getEnv('META_PAGE_ID');

    const data = await graphGet<{
        id: string;
        name: string;
        fan_count: number;
        followers_count: number;
        link: string;
        picture: { data: { url: string } };
    }>(
        `/${pageId}?fields=id,name,fan_count,followers_count,link,picture`,
        token
    );

    const info: FBPageInfo = {
        id: data.id,
        name: data.name,
        fanCount: data.fan_count || 0,
        followersCount: data.followers_count || 0,
        link: data.link || '',
        picture: data.picture?.data?.url || '',
    };

    setCache('fb_page_info', info);
    return info;
}

/**
 * Get Facebook Page daily insights for a date range.
 */
export async function getFBInsights(
    since: string,
    until: string
): Promise<FBInsightsDay[]> {
    const cacheKey = `fb_insights_${since}_${until}`;
    const cached = getCached<FBInsightsDay[]>(cacheKey);
    if (cached) { trackCall('meta', 'getFBInsights', true); return cached; }

    const token = getEnv('META_PAGE_ACCESS_TOKEN');
    const pageId = getEnv('META_PAGE_ID');

    // Valid metrics as of Nov 2025 (page_impressions, page_fans, page_engaged_users deprecated)
    const metrics = 'page_follows,page_views_total,page_post_engagements,page_video_views';

    const data = await graphGet<{
        data: Array<{
            name: string;
            period: string;
            values: Array<{ value: number; end_time: string }>;
        }>;
    }>(
        `/${pageId}/insights?metric=${metrics}&period=day&since=${since}&until=${until}`,
        token
    );

    const dayMap = new Map<string, Partial<FBInsightsDay>>();

    for (const metric of data.data || []) {
        for (const val of metric.values || []) {
            const date = val.end_time.split('T')[0];
            if (!dayMap.has(date)) dayMap.set(date, { date });
            const day = dayMap.get(date)!;

            switch (metric.name) {
                case 'page_follows': day.pageFollows = val.value; break;
                case 'page_views_total': day.pageViewsTotal = val.value; break;
                case 'page_post_engagements': day.pagePostEngagements = val.value; break;
                case 'page_video_views': day.pageVideoViews = val.value; break;
            }
        }
    }

    const result: FBInsightsDay[] = Array.from(dayMap.values())
        .map(d => ({
            date: d.date || '',
            pageFollows: d.pageFollows || 0,
            pageViewsTotal: d.pageViewsTotal || 0,
            pagePostEngagements: d.pagePostEngagements || 0,
            pageVideoViews: d.pageVideoViews || 0,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

    setCache(cacheKey, result);
    return result;
}

// --- Facebook Reviews (Recommendations) ---

export interface FBReview {
    created_time: string;
    rating: number; // 1-5
    review_text: string;
    reviewer: {
        name: string;
    };
    recommendation_type: 'positive' | 'negative' | 'neutral';
}

export interface FBBusinessData {
    pageName: string;
    overall_star_rating: number;
    rating_count: number;
    reviews: FBReview[];
    isMock: boolean;
}

function getMockFBReviews(locationId?: LocationId): FBBusinessData {
    const today = new Date();

    // Facebook Graph API returns "recommendation_type" and text. Star rating is usually derived or returned as overall.
    // We mock star ratings here for consistency across the dashboard.
    const allReviews: (FBReview & { location: LocationId })[] = [
        {
            created_time: new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
            rating: 5,
            review_text: 'Sam is an artist! My lip filler looks so natural. Highly recommend the Atlanta clinic to anyone looking for subtle enhancements.',
            reviewer: { name: 'Ashley M.' },
            recommendation_type: 'positive',
            location: 'atlanta'
        },
        {
            created_time: new Date(today.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString(),
            rating: 5,
            review_text: 'Love the new Decatur location! Staff is always so sweet and professional.',
            reviewer: { name: 'Brittany O.' },
            recommendation_type: 'positive',
            location: 'decatur'
        },
        {
            created_time: new Date(today.getTime() - 25 * 24 * 60 * 60 * 1000).toISOString(),
            rating: 4,
            review_text: 'Great experience getting Botox in Kennesaw. Did wait about 15 minutes past my appointment time.',
            reviewer: { name: 'Sandra K.' },
            recommendation_type: 'positive',
            location: 'kennesaw'
        },
        {
            created_time: new Date(today.getTime() - 40 * 24 * 60 * 60 * 1000).toISOString(),
            rating: 5,
            review_text: 'I\'ve sent three of my friends here. They never miss. Best in Atlanta!',
            reviewer: { name: 'Jessica V.' },
            recommendation_type: 'positive',
            location: 'atlanta'
        }
    ];

    let filteredReviews = allReviews;
    let pageName = 'Chin Up! Aesthetics (All Locations)';
    let totalCount = 89;
    let avg = 4.8;

    if (locationId) {
        filteredReviews = allReviews.filter(r => r.location === locationId);
        if (locationId === 'atlanta') { pageName += ' - Atlanta'; totalCount = 55; avg = 4.9; }
        if (locationId === 'decatur') { pageName += ' - Decatur'; totalCount = 20; avg = 4.6; }
        if (locationId === 'kennesaw') { pageName += ' - Kennesaw'; totalCount = 14; avg = 4.7; }
    }

    return {
        pageName,
        overall_star_rating: avg,
        rating_count: totalCount,
        reviews: filteredReviews.map(({ location, ...rest }) => rest),
        isMock: true,
    };
}

/**
 * Fetches Facebook Page ratings and reviews.
 */
export async function getFBReviews(locationId?: LocationId): Promise<FBBusinessData> {
    const pageId = process.env.META_PAGE_ID;
    const pageToken = process.env.META_PAGE_ACCESS_TOKEN;

    const cacheKey = `fb_reviews_${locationId || 'all'}`;
    const cached = getCached<FBBusinessData>(cacheKey);
    if (cached) { trackCall('meta', 'getFBReviews', true); return cached; }

    trackCall('meta', 'getFBReviews', false);

    // If no credentials are provided, return mock data
    if (!pageId || !pageToken) {
        console.warn('[Meta] Missing META_PAGE_ID or META_PAGE_ACCESS_TOKEN. Falling back to mock FB reviews.');
        const mock = getMockFBReviews(locationId);
        setCache(cacheKey, mock);
        return mock;
    }

    try {
        console.log(`[Meta] Fetching live FB Reviews (Page: ${pageId})...`);
        const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/ratings?fields=created_time,recommendation_type,review_text,reviewer,rating&access_token=${pageToken}`);

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error?.message || 'Failed to fetch FB Reviews');
        }

        const data = await res.json();
        const reviewsRaw: any[] = data.data || [];

        // Map the real data to our expected format
        const reviews: FBReview[] = reviewsRaw.map(raw => ({
            created_time: raw.created_time,
            // Fallback to 5 for positive, 1 for negative if rating is missing
            rating: raw.rating || (raw.recommendation_type === 'positive' ? 5 : (raw.recommendation_type === 'negative' ? 1 : 0)),
            review_text: raw.review_text || '',
            reviewer: raw.reviewer ? { name: raw.reviewer.name } : { name: 'Anonymous Facebook User' },
            recommendation_type: raw.recommendation_type
        })).filter(r => r.rating > 0 && r.review_text); // Only return legitimate reviews with text

        const avgRating = reviews.length > 0
            ? reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length
            : 5.0;

        // Note: Graph API doesn't tie page reviews to a specific "location ID" automatically
        // If they requested a specific location, we just return the global page reviews for now since they are a single brand.
        const output: FBBusinessData = {
            pageName: 'Chin Up! Aesthetics',
            overall_star_rating: Number(avgRating.toFixed(1)),
            rating_count: reviews.length,
            reviews,
            isMock: false
        };

        setCache(cacheKey, output);
        return output;

    } catch (e: any) {
        console.error(`[Meta] Error fetching live FB reviews: ${e.message}`);
        console.warn('[Meta] Falling back to mock FB reviews due to error.');
        const mock = getMockFBReviews(locationId);
        setCache(cacheKey, mock);
        return mock;
    }
}

// --- Instagram Competitor Tracking ---

export interface IGCompetitorMetrics {
    username: string;
    followersCount: number;
    mediaCount: number;
}

function getMockCompetitors(locationId?: LocationId): IGCompetitorMetrics[] {
    // Generate realistic competitor followers based on location
    if (locationId === 'atlanta') {
        return [
            { username: 'atlanta_medspa_elite', followersCount: 12500, mediaCount: 840 },
            { username: 'glow_aesthetics_atl', followersCount: 8200, mediaCount: 412 },
            { username: 'the_beauty_lounge_atl', followersCount: 15100, mediaCount: 1205 }
        ];
    }

    if (locationId === 'decatur') {
        return [
            { username: 'decatur_aesthetics', followersCount: 4500, mediaCount: 320 },
            { username: 'pure_medspa_decatur', followersCount: 6800, mediaCount: 550 }
        ];
    }

    if (locationId === 'kennesaw') {
        return [
            { username: 'kennesaw_skin', followersCount: 5200, mediaCount: 480 },
            { username: 'renew_medspa_kennesaw', followersCount: 3100, mediaCount: 210 }
        ];
    }

    // Default / All Locations
    return [
        { username: 'atlanta_medspa_elite', followersCount: 12500, mediaCount: 840 },
        { username: 'decatur_aesthetics', followersCount: 4500, mediaCount: 320 },
        { username: 'kennesaw_skin', followersCount: 5200, mediaCount: 480 },
        { username: 'glow_aesthetics_atl', followersCount: 8200, mediaCount: 412 },
    ];
}

/**
 * Fetches Competitor Metrics using Instagram Business Discovery API.
 */
export async function getIGCompetitorMetrics(locationId?: LocationId): Promise<IGCompetitorMetrics[]> {
    const igUserId = process.env.META_IG_USER_ID;
    const pageToken = process.env.META_PAGE_ACCESS_TOKEN;

    const cacheKey = `ig_competitors_${locationId || 'all'}`;
    const cached = getCached<IGCompetitorMetrics[]>(cacheKey);
    if (cached) { trackCall('meta', 'getIGCompetitorMetrics', true); return cached; }

    trackCall('meta', 'getIGCompetitorMetrics', false);

    // If no credentials, use mock
    if (!igUserId || !pageToken) {
        console.warn('[Meta] Missing META_IG_USER_ID or META_PAGE_ACCESS_TOKEN. Falling back to mock IG Competitors.');
        const mock = getMockCompetitors(locationId);
        setCache(cacheKey, mock);
        return mock;
    }

    // Determine target mock competitors based on location so we have usernames to query
    const targetMocks = getMockCompetitors(locationId);
    const usernamesToFetch = targetMocks.map(m => m.username);

    const results: IGCompetitorMetrics[] = [];

    console.log(`[Meta] Fetching live IG Competitors for ${usernamesToFetch.length} profiles...`);

    // Fetch sequentially to handle errors gracefully per competitor
    for (const username of usernamesToFetch) {
        try {
            const url = `https://graph.facebook.com/v19.0/${igUserId}?fields=business_discovery.username(${username}){username,followers_count,media_count}&access_token=${pageToken}`;
            const res = await fetch(url);

            if (res.ok) {
                const data = await res.json();
                if (data.business_discovery) {
                    results.push({
                        username: data.business_discovery.username,
                        followersCount: data.business_discovery.followers_count,
                        mediaCount: data.business_discovery.media_count
                    });
                }
            } else {
                // If a specific username fails (e.g. invalid account), log and fallback to the mock data for that specific account
                console.warn(`[Meta] Failed to fetch competitor ${username}. Falling back to mock data for this user.`);
                const mockFallback = targetMocks.find(m => m.username === username);
                if (mockFallback) results.push(mockFallback);
            }
        } catch (e) {
            console.error(`[Meta] Error fetching competitor ${username}`, e);
            const mockFallback = targetMocks.find(m => m.username === username);
            if (mockFallback) results.push(mockFallback);
        }
    }

    setCache(cacheKey, results);
    return results;
}
