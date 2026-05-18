/**
 * Meta Graph API Client — Instagram + Facebook Organic
 * Uses a never-expiring Page Access Token for both IG + FB data.
 * API Version: v22.0 (current as of 2026)
 */

import { trackCall } from '@/lib/api-usage-tracker';
import { createMemCache } from '@/lib/mem-cache';
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
    // Comment-reply tracking (fetched separately, only when commentsCount > 0)
    commentsFetched?: number;       // how many comments we sampled (capped at 50/post)
    commentsReplied?: number;       // of those, how many got a reply from the page
    avgReplyHours?: number | null;  // mean response time in hours
    unrepliedComments?: IGUnrepliedComment[];
}

export interface IGUnrepliedComment {
    id: string;
    text: string;
    username: string;
    timestamp: string;
}

export interface IGStory {
    id: string;
    mediaType: 'IMAGE' | 'VIDEO' | 'STORY';
    mediaUrl: string;
    thumbnailUrl?: string;
    permalink: string;
    timestamp: string;
    // Insights
    reach?: number;
    replies?: number;
    navigationForward?: number;  // taps forward (next story)
    navigationBack?: number;     // taps back
    navigationExited?: number;   // close (negative signal)
    navigationNext?: number;     // swipe to next account (negative signal)
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

export interface FBUnrepliedComment {
    id: string;
    text: string;
    username: string;
    timestamp: string;
}

export interface FBPost {
    id: string;
    message: string;
    permalink: string;
    timestamp: string;
    fullPicture?: string;
    statusType?: string;
    commentsCount: number;
    commentsFetched?: number;
    commentsReplied?: number;
    avgReplyHours?: number | null;
    unrepliedComments?: FBUnrepliedComment[];
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

const metaCache = createMemCache<unknown>(4 * 60 * 60 * 1000); // 4 hours

function getCached<T>(key: string): T | null {
    return metaCache.get(key) as T | null;
}

function setCache(key: string, data: unknown): void {
    metaCache.set(key, data);
}

export function clearMetaCache(): void {
    metaCache.clear();
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
 * Get IG period totals only (no daily breakdown, no follower_count).
 * Used for prior-period delta computation. Supports longer lookback windows
 * than getIGInsights because it skips the follower_count metric (30-day cap).
 */
export async function getIGPeriodTotals(
    since: string,
    until: string
): Promise<{ totalReach: number; totals: IGInsightsTotals }> {
    const cacheKey = `ig_period_totals_${since}_${until}`;
    const cached = getCached<{ totalReach: number; totals: IGInsightsTotals }>(cacheKey);
    if (cached) { trackCall('meta', 'getIGPeriodTotals', true); return cached; }

    const token = getEnv('META_PAGE_ACCESS_TOKEN');
    const igUserId = getEnv('META_IG_USER_ID');

    // Reach daily (no follower_count = no 30-day cap)
    const reachData = await graphGet<{
        data: Array<{ name: string; values: Array<{ value: number; end_time: string }> }>;
    }>(
        `/${igUserId}/insights?metric=reach&period=day&since=${since}&until=${until}`,
        token
    );

    let totalReach = 0;
    for (const metric of reachData.data || []) {
        for (const val of metric.values || []) {
            totalReach += val.value || 0;
        }
    }

    // Aggregate totals
    const totalsData = await graphGet<{
        data: Array<{ name: string; total_value: { value: number } }>;
    }>(
        `/${igUserId}/insights?metric=profile_views,accounts_engaged,total_interactions,likes,comments,shares,saves,views&metric_type=total_value&period=day&since=${since}&until=${until}`,
        token
    );

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

    const result = { totalReach, totals };
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

        // Step 3: Fetch comments + reply detection per post (only if any comments exist)
        if ((m.comments_count || 0) > 0) {
            try {
                const commentsData = await graphGet<{
                    data: Array<{
                        id: string;
                        text: string;
                        timestamp: string;
                        from?: { id: string; username?: string };
                        replies?: {
                            data: Array<{
                                id: string;
                                text: string;
                                timestamp: string;
                                from?: { id: string; username?: string };
                            }>;
                        };
                    }>;
                }>(
                    `/${m.id}/comments?fields=id,text,timestamp,from,replies{id,text,timestamp,from}&limit=50`,
                    token
                );

                let commentsFetched = 0;
                let commentsReplied = 0;
                const replyHourSamples: number[] = [];
                const unrepliedComments: IGUnrepliedComment[] = [];

                for (const c of commentsData.data || []) {
                    // Skip our own top-level comments (e.g., we left a comment on our own post)
                    if (c.from?.id === igUserId) continue;
                    commentsFetched++;

                    const replies = c.replies?.data || [];
                    // Find the earliest reply from us
                    const ourReplies = replies
                        .filter(r => r.from?.id === igUserId)
                        .map(r => new Date(r.timestamp).getTime())
                        .sort((a, b) => a - b);

                    if (ourReplies.length > 0) {
                        commentsReplied++;
                        const commentMs = new Date(c.timestamp).getTime();
                        const replyMs = ourReplies[0];
                        const hours = (replyMs - commentMs) / (1000 * 60 * 60);
                        if (hours >= 0 && hours < 24 * 30) {
                            // Cap at 30 days to filter outliers / clock-skew anomalies
                            replyHourSamples.push(hours);
                        }
                    } else {
                        unrepliedComments.push({
                            id: c.id,
                            text: c.text || '',
                            username: c.from?.username || 'Unknown',
                            timestamp: c.timestamp,
                        });
                    }
                }

                post.commentsFetched = commentsFetched;
                post.commentsReplied = commentsReplied;
                post.unrepliedComments = unrepliedComments;
                post.avgReplyHours = replyHourSamples.length > 0
                    ? Math.round((replyHourSamples.reduce((a, b) => a + b, 0) / replyHourSamples.length) * 100) / 100
                    : null;
            } catch {
                // Comments fetch may fail for very new posts or restricted accounts — continue without
            }
        }

        posts.push(post);
    }

    setCache(cacheKey, posts);
    return posts;
}

/**
 * Get Instagram active stories (last 24h window) with per-story insights.
 * Stories disappear after 24h, so this only returns currently-published ones.
 * For historical Story cadence, a daily cron snapshot is needed (Phase 3.5).
 *
 * Cache TTL is shorter (1 hour) than other endpoints since Stories rotate fast.
 */
export async function getIGStories(): Promise<IGStory[]> {
    const cacheKey = 'ig_stories_active';
    const cached = getCached<IGStory[]>(cacheKey);
    if (cached) { trackCall('meta', 'getIGStories', true); return cached; }

    const token = getEnv('META_PAGE_ACCESS_TOKEN');
    const igUserId = getEnv('META_IG_USER_ID');

    let storiesData: { data: Array<{
        id: string;
        media_type: string;
        media_url?: string;
        thumbnail_url?: string;
        permalink: string;
        timestamp: string;
    }> };

    try {
        storiesData = await graphGet(
            `/${igUserId}/stories?fields=id,media_type,media_url,thumbnail_url,permalink,timestamp`,
            token
        );
    } catch (err) {
        // Account may not have any active stories or endpoint may be restricted — return empty.
        console.warn('[meta-organic] getIGStories failed:', err instanceof Error ? err.message : err);
        const empty: IGStory[] = [];
        setCache(cacheKey, empty);
        return empty;
    }

    const stories: IGStory[] = [];

    for (const s of storiesData.data || []) {
        const story: IGStory = {
            id: s.id,
            mediaType: (s.media_type as IGStory['mediaType']) || 'STORY',
            mediaUrl: s.media_url || '',
            thumbnailUrl: s.thumbnail_url,
            permalink: s.permalink || '',
            timestamp: s.timestamp,
        };

        // Per-story insights — Stories support different metrics than feed posts
        try {
            const storyMetrics = 'reach,replies,navigation';
            const insightsData = await graphGet<{
                data: Array<{ name: string; values: Array<{ value: number | Record<string, number> }> }>;
            }>(
                `/${s.id}/insights?metric=${storyMetrics}`,
                token
            );

            for (const metric of insightsData.data || []) {
                const v = metric.values?.[0]?.value;
                switch (metric.name) {
                    case 'reach':
                        if (typeof v === 'number') story.reach = v;
                        break;
                    case 'replies':
                        if (typeof v === 'number') story.replies = v;
                        break;
                    case 'navigation':
                        // navigation comes back as a breakdown object: { forward, back, exited, next_story }
                        if (typeof v === 'object' && v !== null) {
                            const nav = v as Record<string, number>;
                            story.navigationForward = nav.forward || nav.tap_forward || 0;
                            story.navigationBack = nav.back || nav.tap_back || 0;
                            story.navigationExited = nav.exited || 0;
                            story.navigationNext = nav.next_story || 0;
                        }
                        break;
                }
            }
        } catch {
            // Insights may fail for very new stories — continue without
        }

        stories.push(story);
    }

    setCache(cacheKey, stories);
    return stories;
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

/**
 * Get recent Facebook Page posts with comments + reply detection.
 * Mirrors getIGMedia's comment-inbox logic.
 */
export async function getFBPosts(limit: number = 15): Promise<FBPost[]> {
    const cacheKey = `fb_posts_${limit}`;
    const cached = getCached<FBPost[]>(cacheKey);
    if (cached) { trackCall('meta', 'getFBPosts', true); return cached; }

    const token = getEnv('META_PAGE_ACCESS_TOKEN');
    const pageId = getEnv('META_PAGE_ID');

    const postsData = await graphGet<{
        data: Array<{
            id: string;
            message?: string;
            permalink_url?: string;
            created_time: string;
            full_picture?: string;
            status_type?: string;
            comments?: { summary?: { total_count: number } };
        }>;
    }>(
        `/${pageId}/posts?fields=id,message,permalink_url,created_time,full_picture,status_type,comments.summary(true).limit(0)&limit=${limit}`,
        token
    );

    const result: FBPost[] = [];

    for (const p of postsData.data || []) {
        const commentsCount = p.comments?.summary?.total_count || 0;
        const post: FBPost = {
            id: p.id,
            message: p.message || '',
            permalink: p.permalink_url || '',
            timestamp: p.created_time,
            fullPicture: p.full_picture,
            statusType: p.status_type,
            commentsCount,
        };

        if (commentsCount > 0) {
            try {
                const commentsData = await graphGet<{
                    data: Array<{
                        id: string;
                        message?: string;
                        created_time: string;
                        from?: { id: string; name?: string };
                        comments?: {
                            data: Array<{
                                id: string;
                                message?: string;
                                created_time: string;
                                from?: { id: string; name?: string };
                            }>;
                        };
                    }>;
                }>(
                    `/${p.id}/comments?fields=id,message,created_time,from,comments{id,message,created_time,from}&filter=stream&limit=50`,
                    token
                );
                console.log(`[FB-INBOX] post=${p.id} summary_count=${commentsCount} fetched=${(commentsData.data || []).length} first_from=${JSON.stringify(commentsData.data?.[0]?.from)}`);

                let commentsFetched = 0;
                let commentsReplied = 0;
                const replyHourSamples: number[] = [];
                const unrepliedComments: FBUnrepliedComment[] = [];

                for (const c of commentsData.data || []) {
                    if (c.from?.id === pageId) continue; // skip our own top-level comments
                    commentsFetched++;

                    const replies = c.comments?.data || [];
                    const ourReplies = replies
                        .filter(r => r.from?.id === pageId)
                        .map(r => new Date(r.created_time).getTime())
                        .sort((a, b) => a - b);

                    if (ourReplies.length > 0) {
                        commentsReplied++;
                        const commentMs = new Date(c.created_time).getTime();
                        const hours = (ourReplies[0] - commentMs) / (1000 * 60 * 60);
                        if (hours >= 0 && hours < 24 * 30) replyHourSamples.push(hours);
                    } else {
                        unrepliedComments.push({
                            id: c.id,
                            text: c.message || '',
                            username: c.from?.name || 'Unknown',
                            timestamp: c.created_time,
                        });
                    }
                }

                post.commentsFetched = commentsFetched;
                post.commentsReplied = commentsReplied;
                post.unrepliedComments = unrepliedComments;
                post.avgReplyHours = replyHourSamples.length > 0
                    ? Math.round((replyHourSamples.reduce((a, b) => a + b, 0) / replyHourSamples.length) * 100) / 100
                    : null;
            } catch (err) {
                console.error(`[FB-INBOX] comments fetch failed for post ${p.id}:`, err instanceof Error ? err.message : err);
            }
        }

        result.push(post);
    }

    console.log(`[FB-INBOX] posts=${result.length} total_comments=${result.reduce((s, p) => s + (p.commentsCount || 0), 0)} fetched=${result.reduce((s, p) => s + (p.commentsFetched || 0), 0)} unreplied=${result.reduce((s, p) => s + (p.unrepliedComments?.length || 0), 0)}`);
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

export interface IGCompetitorPost {
    caption: string;
    likeCount: number;
    commentsCount: number;
    mediaType: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
    permalink: string;
    timestamp: string;
}

export interface IGCompetitorMetrics {
    username: string;
    followersCount: number;
    mediaCount: number;
    // Engagement data (from recent 12 posts)
    recentPosts?: IGCompetitorPost[];
    avgEngagementRate?: number;
    postingFrequency?: number; // posts per week
    contentMix?: { images: number; videos: number; carousels: number };
    topHashtags?: { tag: string; count: number }[];
    bestPost?: IGCompetitorPost & { engagementRate: number };
    engagementTrend?: 'growing' | 'declining' | 'stable';
    viralPosts?: (IGCompetitorPost & { engagementRate: number; multiplier: number })[];
}

function getMockCompetitors(locationId?: LocationId): IGCompetitorMetrics[] {
    // Generate realistic competitor followers based on location
    if (locationId === 'atlanta') {
        return [
            { username: 'pureblissmedspa', followersCount: 40269, mediaCount: 553 },
            { username: 'skinsocialspa', followersCount: 4247, mediaCount: 618 },
            { username: 'radiancemedspaatl', followersCount: 2969, mediaCount: 1067 }
        ];
    }

    if (locationId === 'decatur') {
        return [
            { username: 'seamlessrecoverymedspa', followersCount: 1222, mediaCount: 236 },
            { username: 'revolutiondecatur', followersCount: 1094, mediaCount: 340 }
        ];
    }

    if (locationId === 'kennesaw') {
        return [
            { username: 'vivamedspaatl', followersCount: 3811, mediaCount: 421 },
            { username: 'spalapazatl', followersCount: 2382, mediaCount: 443 }
        ];
    }

    // Default / All Locations
    return [
        { username: 'pureblissmedspa', followersCount: 40269, mediaCount: 553 },
        { username: 'seamlessrecoverymedspa', followersCount: 1222, mediaCount: 236 },
        { username: 'vivamedspaatl', followersCount: 3811, mediaCount: 421 },
        { username: 'skinsocialspa', followersCount: 4247, mediaCount: 618 },
    ];
}

/**
 * Compute engagement metrics from a competitor's recent posts.
 */
function computeCompetitorEngagement(
    username: string,
    followersCount: number,
    posts: IGCompetitorPost[]
): Partial<IGCompetitorMetrics> {
    if (!posts.length) return {};

    // Avg engagement rate
    const engagementRates = posts.map(p =>
        followersCount > 0 ? (p.likeCount + p.commentsCount) / followersCount : 0
    );
    const avgEngagementRate = engagementRates.reduce((a, b) => a + b, 0) / engagementRates.length;

    // Posting frequency (posts per week)
    const timestamps = posts.map(p => new Date(p.timestamp).getTime()).sort((a, b) => a - b);
    const spanDays = timestamps.length > 1
        ? (timestamps[timestamps.length - 1] - timestamps[0]) / (1000 * 60 * 60 * 24)
        : 7;
    const postingFrequency = spanDays > 0 ? (posts.length / spanDays) * 7 : posts.length;

    // Content mix
    const contentMix = { images: 0, videos: 0, carousels: 0 };
    for (const p of posts) {
        if (p.mediaType === 'IMAGE') contentMix.images++;
        else if (p.mediaType === 'VIDEO') contentMix.videos++;
        else if (p.mediaType === 'CAROUSEL_ALBUM') contentMix.carousels++;
    }

    // Top hashtags from captions
    const hashtagCounts = new Map<string, number>();
    for (const p of posts) {
        const tags = p.caption.match(/#\w+/g) || [];
        for (const tag of tags) {
            const lower = tag.toLowerCase();
            hashtagCounts.set(lower, (hashtagCounts.get(lower) || 0) + 1);
        }
    }
    const topHashtags = Array.from(hashtagCounts.entries())
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

    // Best performing post
    const postsWithEngagement = posts.map(p => ({
        ...p,
        engagementRate: followersCount > 0 ? (p.likeCount + p.commentsCount) / followersCount : 0,
    }));
    const bestPost = postsWithEngagement.reduce((best, p) =>
        (p.likeCount + p.commentsCount) > (best.likeCount + best.commentsCount) ? p : best
    );

    // Engagement trend (first half vs second half by time)
    const sorted = [...postsWithEngagement].sort((a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    const half = Math.floor(sorted.length / 2);
    const olderAvg = half > 0 ? sorted.slice(0, half).reduce((s, p) => s + p.engagementRate, 0) / half : 0;
    const newerAvg = half > 0 ? sorted.slice(half).reduce((s, p) => s + p.engagementRate, 0) / (sorted.length - half) : 0;
    const trendDiff = olderAvg > 0 ? (newerAvg - olderAvg) / olderAvg : 0;
    const engagementTrend: 'growing' | 'declining' | 'stable' =
        trendDiff > 0.15 ? 'growing' : trendDiff < -0.15 ? 'declining' : 'stable';

    // Viral posts: engagement > 3x average AND likes+comments > 100
    const viralPosts = postsWithEngagement
        .filter(p => p.engagementRate > avgEngagementRate * 3 && (p.likeCount + p.commentsCount) > 100)
        .map(p => ({ ...p, multiplier: Math.round(p.engagementRate / avgEngagementRate * 10) / 10 }))
        .sort((a, b) => b.multiplier - a.multiplier);

    return {
        avgEngagementRate,
        postingFrequency: Math.round(postingFrequency * 10) / 10,
        contentMix,
        topHashtags,
        bestPost,
        engagementTrend,
        viralPosts: viralPosts.length > 0 ? viralPosts : undefined,
    };
}

/**
 * Fetches Competitor Metrics using Instagram Business Discovery API.
 * Now includes recent 12 posts with engagement data, content mix, and viral detection.
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

    console.log(`[Meta] Fetching live IG Competitors (with engagement) for ${usernamesToFetch.length} profiles...`);

    // Fetch sequentially to handle errors gracefully per competitor
    for (const username of usernamesToFetch) {
        try {
            // Expanded query: profile + recent 12 posts with engagement data
            const fields = `business_discovery.username(${username}){username,followers_count,media_count,media.limit(12){caption,like_count,comments_count,media_type,permalink,timestamp}}`;
            const url = `${GRAPH_BASE}/${igUserId}?fields=${fields}&access_token=${pageToken}`;
            const res = await fetch(url);

            if (res.ok) {
                const data = await res.json();
                const bd = data.business_discovery;
                if (bd) {
                    const recentPosts: IGCompetitorPost[] = (bd.media?.data || []).map((m: any) => ({
                        caption: m.caption || '',
                        likeCount: m.like_count || 0,
                        commentsCount: m.comments_count || 0,
                        mediaType: m.media_type as IGCompetitorPost['mediaType'],
                        permalink: m.permalink || '',
                        timestamp: m.timestamp || '',
                    }));

                    const engagement = computeCompetitorEngagement(
                        bd.username, bd.followers_count, recentPosts
                    );

                    results.push({
                        username: bd.username,
                        followersCount: bd.followers_count,
                        mediaCount: bd.media_count,
                        recentPosts,
                        ...engagement,
                    });
                }
            } else {
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
