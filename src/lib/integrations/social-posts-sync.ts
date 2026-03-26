/**
 * Social Posts Sync — Backfill + Incremental
 * Fetches IG posts with metrics from Meta Graph API and stores in social_posts table.
 * Follows the same chunked backfill pattern as mindbody-sync.ts.
 */

import { sql } from '@vercel/postgres';
import { IGMedia, isMetaConfigured } from './meta-organic';

const GRAPH_API_VERSION = 'v22.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const PAGES_PER_CHUNK = 3; // 3 pages × 50 posts = ~150 posts per invocation
const PAGE_SIZE = 50;

interface SyncResult {
    total: number;
    apiCalls: number;
    done: boolean;
    chunkLabel: string;
    continue?: boolean;
}

// --- Graph API helpers (standalone, no cache) ---

async function graphGet<T>(endpoint: string, token: string): Promise<T> {
    const url = `${GRAPH_BASE}${endpoint}${endpoint.includes('?') ? '&' : '?'}access_token=${token}`;
    const response = await fetch(url);
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(`Meta Graph API error: ${response.status} ${endpoint} — ${JSON.stringify(err)}`);
    }
    return response.json() as Promise<T>;
}

/**
 * Fetch a page of IG media with optional cursor, including per-post insights.
 */
async function fetchIGMediaPage(
    igUserId: string,
    token: string,
    afterCursor?: string,
    limit: number = PAGE_SIZE,
): Promise<{ posts: IGMedia[]; nextCursor: string | null; apiCalls: number }> {
    let apiCalls = 0;

    const cursorParam = afterCursor ? `&after=${afterCursor}` : '';
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
        paging?: { cursors?: { after?: string }; next?: string };
    }>(
        `/${igUserId}/media?fields=id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count&limit=${limit}${cursorParam}`,
        token,
    );
    apiCalls++;

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

        // Fetch insights per post
        try {
            const isReel = m.media_type === 'VIDEO';
            const postMetrics = isReel
                ? 'views,reach,likes,comments,shares,saved,total_interactions,plays'
                : 'views,reach,likes,comments,shares,saved,total_interactions';

            const insightsData = await graphGet<{
                data: Array<{ name: string; values: Array<{ value: number }> }>;
            }>(`/${m.id}/insights?metric=${postMetrics}`, token);
            apiCalls++;

            for (const metric of insightsData.data || []) {
                const value = metric.values?.[0]?.value || 0;
                switch (metric.name) {
                    case 'views': post.views = value; break;
                    case 'reach': post.reach = value; break;
                    case 'shares': post.shares = value; break;
                    case 'saved': post.saved = value; break;
                    case 'total_interactions': post.totalInteractions = value; break;
                    case 'plays': post.plays = value; break;
                }
            }
        } catch {
            // Insights may fail for stories or very new posts
        }

        posts.push(post);
    }

    const nextCursor = mediaData.paging?.next ? (mediaData.paging.cursors?.after || null) : null;
    return { posts, nextCursor, apiCalls };
}

/**
 * Upsert an array of IGMedia posts into social_posts table.
 */
async function upsertPosts(posts: IGMedia[]): Promise<number> {
    let inserted = 0;

    for (const p of posts) {
        const likes = p.likeCount || 0;
        const comments = p.commentsCount || 0;
        const shares = p.shares || 0;
        const saves = p.saved || 0;
        const views = p.views || 0;
        const reach = p.reach || 0;
        const denominator = Math.max(views, reach, 1);
        const engagementRate = (likes + comments + shares + saves) / denominator;

        await sql`
            INSERT INTO social_posts (platform, post_id, post_type, posted_at, caption, permalink, likes, comments, shares, saves, views, reach, impressions, engagement_rate, updated_at)
            VALUES (
                'instagram',
                ${p.id},
                ${p.mediaType},
                ${p.timestamp},
                ${p.caption},
                ${p.permalink},
                ${likes},
                ${comments},
                ${shares},
                ${saves},
                ${views},
                ${reach},
                ${p.totalInteractions || 0},
                ${engagementRate},
                NOW()
            )
            ON CONFLICT (platform, post_id) DO UPDATE SET
                likes = EXCLUDED.likes,
                comments = EXCLUDED.comments,
                shares = EXCLUDED.shares,
                saves = EXCLUDED.saves,
                views = EXCLUDED.views,
                reach = EXCLUDED.reach,
                impressions = EXCLUDED.impressions,
                engagement_rate = EXCLUDED.engagement_rate,
                updated_at = NOW()
        `;
        inserted++;
    }

    return inserted;
}

/**
 * Chunked backfill — paginates through ALL IG posts.
 * Call repeatedly while result.done === false.
 */
export async function backfillSocialPosts(): Promise<SyncResult> {
    if (!isMetaConfigured()) {
        return { total: 0, apiCalls: 0, done: true, chunkLabel: 'Meta not configured — skipped' };
    }

    // Check if already complete
    const doneCheck = await sql`SELECT sync_type FROM mb_sync_state WHERE sync_type = 'social_posts'`;
    if (doneCheck.rows.length > 0) {
        return { total: 0, apiCalls: 0, done: true, chunkLabel: 'Social posts backfill already complete' };
    }

    // Load progress
    const progressRow = await sql`SELECT * FROM mb_sync_state WHERE sync_type = 'social_posts_backfill_progress'`;
    const cursor = progressRow.rows[0]?.cursor_data ? JSON.parse(progressRow.rows[0].cursor_data) : {};
    let afterCursor: string | undefined = cursor.afterCursor;
    const previousTotal = Number(progressRow.rows[0]?.total_records || 0);

    const token = process.env.META_PAGE_ACCESS_TOKEN!;
    const igUserId = process.env.META_IG_USER_ID!;

    let totalInserted = 0;
    let totalApiCalls = 0;

    for (let page = 0; page < PAGES_PER_CHUNK; page++) {
        const { posts, nextCursor, apiCalls } = await fetchIGMediaPage(igUserId, token, afterCursor);
        totalApiCalls += apiCalls;

        if (posts.length > 0) {
            const inserted = await upsertPosts(posts);
            totalInserted += inserted;
        }

        if (!nextCursor) {
            // No more pages — backfill complete
            const countRes = await sql`SELECT COUNT(*)::int AS cnt FROM social_posts`;
            const totalCount = countRes.rows[0]?.cnt || 0;

            await sql`
                INSERT INTO mb_sync_state (sync_type, last_sync_date, total_records, updated_at)
                VALUES ('social_posts', CURRENT_DATE, ${totalCount}, NOW())
                ON CONFLICT (sync_type) DO UPDATE SET
                    last_sync_date = CURRENT_DATE,
                    total_records = ${totalCount},
                    updated_at = NOW()
            `;
            await sql`DELETE FROM mb_sync_state WHERE sync_type = 'social_posts_backfill_progress'`;

            return {
                total: totalInserted,
                apiCalls: totalApiCalls,
                done: true,
                chunkLabel: `Backfill complete — ${totalCount} total posts stored`,
            };
        }

        afterCursor = nextCursor;
    }

    // Save progress for next chunk
    const newTotal = previousTotal + totalInserted;
    const cursorJson = JSON.stringify({ afterCursor });
    await sql`
        INSERT INTO mb_sync_state (sync_type, last_sync_date, total_records, cursor_data, updated_at)
        VALUES ('social_posts_backfill_progress', CURRENT_DATE, ${newTotal}, ${cursorJson}, NOW())
        ON CONFLICT (sync_type) DO UPDATE SET
            total_records = ${newTotal},
            cursor_data = ${cursorJson},
            updated_at = NOW()
    `;

    return {
        total: totalInserted,
        apiCalls: totalApiCalls,
        done: false,
        chunkLabel: `Stored ${totalInserted} posts this chunk (${newTotal} total so far)`,
        continue: true,
    };
}

/**
 * Incremental sync — fetches latest 50 posts and upserts (updates metrics on existing).
 */
export async function incrementalSocialSync(): Promise<SyncResult> {
    if (!isMetaConfigured()) {
        return { total: 0, apiCalls: 0, done: true, chunkLabel: 'Meta not configured — skipped' };
    }

    const token = process.env.META_PAGE_ACCESS_TOKEN!;
    const igUserId = process.env.META_IG_USER_ID!;

    const { posts, apiCalls } = await fetchIGMediaPage(igUserId, token, undefined, 50);
    const inserted = posts.length > 0 ? await upsertPosts(posts) : 0;

    // Update sync state
    await sql`
        INSERT INTO mb_sync_state (sync_type, last_sync_date, total_records, updated_at)
        VALUES ('social_posts', CURRENT_DATE, (SELECT COUNT(*)::int FROM social_posts), NOW())
        ON CONFLICT (sync_type) DO UPDATE SET
            last_sync_date = CURRENT_DATE,
            total_records = (SELECT COUNT(*)::int FROM social_posts),
            updated_at = NOW()
    `;

    return {
        total: inserted,
        apiCalls,
        done: true,
        chunkLabel: `Synced ${inserted} recent posts`,
    };
}

/**
 * Get sync stats for social posts.
 */
export async function getSocialPostsStats(): Promise<{
    totalPosts: number;
    lastSync: string | null;
    platforms: Array<{ platform: string; count: number }>;
}> {
    const [countRes, stateRes, platformRes] = await Promise.all([
        sql`SELECT COUNT(*)::int AS cnt FROM social_posts`,
        sql`SELECT last_sync_date FROM mb_sync_state WHERE sync_type = 'social_posts'`,
        sql`SELECT platform, COUNT(*)::int AS count FROM social_posts GROUP BY platform`,
    ]);

    return {
        totalPosts: countRes.rows[0]?.cnt || 0,
        lastSync: stateRes.rows[0]?.last_sync_date || null,
        platforms: platformRes.rows.map(r => ({ platform: r.platform, count: r.count })),
    };
}
