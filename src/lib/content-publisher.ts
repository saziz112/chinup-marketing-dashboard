/**
 * Content Publisher
 * 
 * Manages post creation, scheduling, and publishing to social platforms.
 * Uses Vercel Postgres for persistent storage instead of in-memory arrays.
 * Calls real Meta Graph API for Facebook and Instagram publishing.
 */

import { publishToMultiplePlatforms, PublishResult } from '@/lib/integrations/meta-publisher';
import { sql } from '@vercel/postgres';

export type MediaType = 'photo' | 'video';

export type Platform = 'instagram' | 'facebook' | 'youtube';
export type PostStatus = 'DRAFT' | 'SCHEDULED' | 'PUBLISHING' | 'PUBLISHED' | 'PARTIAL' | 'FAILED';

export interface PublishRequest {
    platforms: Platform[];
    title?: string;
    caption: string;
    mediaUrls: string[];
    mediaType?: MediaType; // 'photo' or 'video' — auto-detected if not provided
    scheduledFor?: string; // ISO string, if undefined post immediately
}

export interface PostRecord {
    id: string;
    platforms: Platform[];
    title?: string;
    caption: string;
    mediaUrls: string[];
    mediaType?: MediaType;
    status: PostStatus;
    scheduledFor?: string;
    createdAt: string;
    publishedAt?: string;
    errors?: Record<string, string>;
    publishResults?: PublishResult[];
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
                publish_results TEXT DEFAULT '[]'
            )
        `;
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
        scheduledFor: row.scheduled_for?.toISOString(),
        createdAt: row.created_at?.toISOString() || new Date().toISOString(),
        publishedAt: row.published_at?.toISOString(),
        errors: JSON.parse(row.errors || '{}'),
        publishResults: JSON.parse(row.publish_results || '[]'),
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

    // If not scheduled, publish immediately
    if (!isScheduled) {
        const mediaUrl = req.mediaUrls?.[0] || undefined;
        publishResults = await publishToMultiplePlatforms(req.platforms, req.caption, mediaUrl, req.mediaType);

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
    await sql`
        INSERT INTO content_posts (id, platforms, title, caption, media_urls, status, scheduled_for, created_at, published_at, errors, publish_results)
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
            ${JSON.stringify(publishResults)}
        )
    `;

    return {
        id,
        platforms: req.platforms,
        title: req.title,
        caption: req.caption,
        mediaUrls: req.mediaUrls || [],
        status,
        scheduledFor: req.scheduledFor,
        createdAt: now.toISOString(),
        publishedAt: publishedAt?.toISOString(),
        errors: Object.keys(errors).length > 0 ? errors : undefined,
        publishResults,
    };
}

export async function getPosts(status?: PostStatus): Promise<PostRecord[]> {
    await ensurePostsTable();

    let result;
    if (status) {
        result = await sql`SELECT * FROM content_posts WHERE status = ${status} ORDER BY created_at DESC`;
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
