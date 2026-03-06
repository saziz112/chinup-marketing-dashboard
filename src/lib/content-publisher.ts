/**
 * Content Publisher
 * 
 * Manages post creation, scheduling, and publishing to social platforms.
 * Uses Vercel Postgres for persistent storage instead of in-memory arrays.
 * Calls real Meta Graph API for Facebook and Instagram publishing.
 */

import { publishToMultiplePlatforms, PublishResult, PostType } from '@/lib/integrations/meta-publisher';
import { sql } from '@vercel/postgres';

export type MediaType = 'photo' | 'video';

export type Platform = 'instagram' | 'facebook' | 'youtube' | 'google-business';
export type PostStatus = 'DRAFT' | 'SCHEDULED' | 'PUBLISHING' | 'PUBLISHED' | 'PARTIAL' | 'FAILED';

export interface PublishRequest {
    platforms: Platform[];
    title?: string;
    caption: string;
    mediaUrls: string[];
    mediaType?: MediaType; // 'photo' or 'video' — auto-detected if not provided
    postType?: PostType;   // 'feed' | 'reel' | 'story' — defaults to 'feed'
    scheduledFor?: string; // ISO string, if undefined post immediately
    gbpLocations?: string[]; // GBP location keys: 'decatur', 'smyrna', 'kennesaw'
    createdBy?: string;    // User email who created the post
    creativeImageId?: string; // Link to creative_images.id if published from gallery
}

export interface PostRecord {
    id: string;
    platforms: Platform[];
    title?: string;
    caption: string;
    mediaUrls: string[];
    mediaType?: MediaType;
    status: PostStatus;
    postType?: string;
    scheduledFor?: string;
    createdAt: string;
    publishedAt?: string;
    createdBy?: string;
    archivedAt?: string;
    errors?: Record<string, string>;
    publishResults?: PublishResult[];
    metadata?: Record<string, unknown>;
}

// ─── Database Helpers ───────────────────────────────────────────────────────

async function ensurePostsTable() {
    try {
        await sql`
            CREATE TABLE IF NOT EXISTS content_posts (
                id TEXT PRIMARY KEY,
                platforms TEXT NOT NULL,
                title TEXT,
                caption TEXT NOT NULL,
                media_urls TEXT DEFAULT '[]',
                status TEXT NOT NULL DEFAULT 'DRAFT',
                scheduled_for TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                published_at TIMESTAMPTZ,
                errors TEXT DEFAULT '{}',
                publish_results TEXT DEFAULT '[]',
                metadata TEXT DEFAULT '{}'
            )
        `;
        // Add columns to existing tables
        await sql`ALTER TABLE content_posts ADD COLUMN IF NOT EXISTS metadata TEXT DEFAULT '{}'`;
        await sql`ALTER TABLE content_posts ADD COLUMN IF NOT EXISTS created_by VARCHAR(255)`;
        await sql`ALTER TABLE content_posts ADD COLUMN IF NOT EXISTS post_type VARCHAR(20) DEFAULT 'feed'`;
        await sql`ALTER TABLE content_posts ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`;
    } catch (e) {
        // Table may already exist — ignore
    }
}

function rowToPost(row: any): PostRecord {
    return {
        id: row.id,
        platforms: JSON.parse(row.platforms || '[]'),
        title: row.title,
        caption: row.caption,
        mediaUrls: JSON.parse(row.media_urls || '[]'),
        status: row.status,
        postType: row.post_type || 'feed',
        scheduledFor: row.scheduled_for?.toISOString(),
        createdAt: row.created_at?.toISOString() || new Date().toISOString(),
        publishedAt: row.published_at?.toISOString(),
        createdBy: row.created_by || undefined,
        archivedAt: row.archived_at?.toISOString() || undefined,
        errors: JSON.parse(row.errors || '{}'),
        publishResults: JSON.parse(row.publish_results || '[]'),
        metadata: JSON.parse(row.metadata || '{}'),
    };
}

// ─── CRUD Operations ────────────────────────────────────────────────────────

export async function createPost(req: PublishRequest): Promise<PostRecord> {
    await ensurePostsTable();

    const isScheduled = !!req.scheduledFor && new Date(req.scheduledFor) > new Date();
    const id = `post_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const now = new Date();

    let status: PostStatus = isScheduled ? 'SCHEDULED' : 'PUBLISHING';
    let publishedAt: Date | null = null;
    let errors: Record<string, string> = {};
    let publishResults: PublishResult[] = [];
    const metadata: Record<string, unknown> = {};
    if (req.gbpLocations && req.gbpLocations.length > 0) {
        metadata.gbpLocations = req.gbpLocations;
    }

    // If not scheduled, publish immediately
    if (!isScheduled) {
        const mediaUrl = req.mediaUrls?.[0] || undefined;
        publishResults = await publishToMultiplePlatforms(req.platforms, req.caption, mediaUrl, req.mediaType, req.postType || 'feed', req.gbpLocations);

        const allSucceeded = publishResults.every(r => r.success);
        const someSucceeded = publishResults.some(r => r.success);

        if (allSucceeded) {
            status = 'PUBLISHED';
            publishedAt = new Date();
        } else if (someSucceeded) {
            status = 'PARTIAL';
            publishedAt = new Date();
        } else {
            status = 'FAILED';
        }

        // Collect any errors
        for (const r of publishResults) {
            if (!r.success && r.error) {
                errors[r.platform] = r.error;
            }
        }
    }

    // Persist to database
    const postType = req.postType || 'feed';
    await sql`
        INSERT INTO content_posts (id, platforms, title, caption, media_urls, status, scheduled_for, created_at, published_at, errors, publish_results, metadata, created_by, post_type)
        VALUES (
            ${id},
            ${JSON.stringify(req.platforms)},
            ${req.title || null},
            ${req.caption},
            ${JSON.stringify(req.mediaUrls || [])},
            ${status},
            ${req.scheduledFor || null},
            ${now.toISOString()},
            ${publishedAt?.toISOString() || null},
            ${JSON.stringify(errors)},
            ${JSON.stringify(publishResults)},
            ${JSON.stringify(metadata)},
            ${req.createdBy || null},
            ${postType}
        )
    `;

    // Link creative image to this post if publishing from gallery
    if (req.creativeImageId && status !== 'FAILED') {
        for (const platform of req.platforms) {
            try {
                await sql`
                    INSERT INTO creative_post_usage (creative_image_id, content_post_id, platform)
                    VALUES (${req.creativeImageId}, ${id}, ${platform})
                    ON CONFLICT DO NOTHING
                `;
            } catch {
                // Non-critical — don't fail the publish
            }
        }
    }

    return {
        id,
        platforms: req.platforms,
        title: req.title,
        caption: req.caption,
        mediaUrls: req.mediaUrls || [],
        status,
        postType,
        scheduledFor: req.scheduledFor,
        createdAt: now.toISOString(),
        publishedAt: publishedAt?.toISOString(),
        createdBy: req.createdBy,
        errors: Object.keys(errors).length > 0 ? errors : undefined,
        publishResults,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    };
}

export async function getPosts(status?: PostStatus, includeArchived = false): Promise<PostRecord[]> {
    await ensurePostsTable();

    let result;
    if (status && !includeArchived) {
        result = await sql`SELECT * FROM content_posts WHERE status = ${status} AND archived_at IS NULL ORDER BY created_at DESC`;
    } else if (status) {
        result = await sql`SELECT * FROM content_posts WHERE status = ${status} ORDER BY created_at DESC`;
    } else if (!includeArchived) {
        result = await sql`SELECT * FROM content_posts WHERE archived_at IS NULL ORDER BY created_at DESC`;
    } else {
        result = await sql`SELECT * FROM content_posts ORDER BY created_at DESC`;
    }

    return result.rows.map(rowToPost);
}

export async function getPostsByDateRange(startDate: string, endDate: string): Promise<PostRecord[]> {
    await ensurePostsTable();

    const result = await sql`
        SELECT * FROM content_posts 
        WHERE created_at >= ${startDate} AND created_at <= ${endDate}
        ORDER BY created_at DESC
    `;

    return result.rows.map(rowToPost);
}

export async function updatePostStatus(id: string, newStatus: PostStatus): Promise<PostRecord | null> {
    await ensurePostsTable();

    const result = await sql`
        UPDATE content_posts SET status = ${newStatus}
        WHERE id = ${id}
        RETURNING *
    `;

    if (result.rows.length === 0) return null;
    return rowToPost(result.rows[0]);
}

export async function deletePost(id: string): Promise<boolean> {
    await ensurePostsTable();

    const result = await sql`DELETE FROM content_posts WHERE id = ${id}`;
    return (result.rowCount ?? 0) > 0;
}

export async function updatePost(id: string, fields: {
    caption?: string;
    platforms?: Platform[];
    scheduledFor?: string;
    mediaUrls?: string[];
    postType?: string;
    gbpLocations?: string[];
    status?: PostStatus;
}): Promise<PostRecord | null> {
    await ensurePostsTable();

    // Build metadata update if gbpLocations changed
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (fields.caption !== undefined) {
        updates.push(`caption = $${paramIdx++}`);
        values.push(fields.caption);
    }
    if (fields.platforms !== undefined) {
        updates.push(`platforms = $${paramIdx++}`);
        values.push(JSON.stringify(fields.platforms));
    }
    if (fields.scheduledFor !== undefined) {
        updates.push(`scheduled_for = $${paramIdx++}`);
        values.push(fields.scheduledFor);
    }
    if (fields.mediaUrls !== undefined) {
        updates.push(`media_urls = $${paramIdx++}`);
        values.push(JSON.stringify(fields.mediaUrls));
    }
    if (fields.postType !== undefined) {
        updates.push(`post_type = $${paramIdx++}`);
        values.push(fields.postType);
    }
    if (fields.status !== undefined) {
        updates.push(`status = $${paramIdx++}`);
        values.push(fields.status);
    }
    if (fields.gbpLocations !== undefined) {
        updates.push(`metadata = $${paramIdx++}`);
        values.push(JSON.stringify({ gbpLocations: fields.gbpLocations }));
    }

    if (updates.length === 0) return null;

    values.push(id);
    const query = `UPDATE content_posts SET ${updates.join(', ')} WHERE id = $${paramIdx} AND status = 'SCHEDULED' RETURNING *`;
    const result = await sql.query(query, values);

    if (result.rows.length === 0) return null;
    return rowToPost(result.rows[0]);
}

export async function archiveOldPosts(daysOld = 7): Promise<number> {
    await ensurePostsTable();

    const result = await sql`
        UPDATE content_posts
        SET archived_at = NOW()
        WHERE status IN ('PUBLISHED', 'FAILED', 'PARTIAL')
        AND published_at < NOW() - CAST(${daysOld + ' days'} AS INTERVAL)
        AND archived_at IS NULL
    `;
    return result.rowCount ?? 0;
}

// ─── Publishing Stats for Goals ─────────────────────────────────────────────

export async function getPostCountByPlatform(
    startDate: string,
    endDate: string
): Promise<Record<string, number>> {
    await ensurePostsTable();

    const result = await sql`
        SELECT platforms FROM content_posts 
        WHERE status IN ('PUBLISHED', 'PARTIAL')
        AND published_at >= ${startDate} AND published_at <= ${endDate}
    `;

    const counts: Record<string, number> = { instagram: 0, facebook: 0, youtube: 0, total: 0 };
    for (const row of result.rows) {
        const platforms: string[] = JSON.parse(row.platforms || '[]');
        for (const p of platforms) {
            counts[p] = (counts[p] || 0) + 1;
        }
        counts.total += 1;
    }
    return counts;
}
