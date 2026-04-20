/**
 * /api/creatives/history
 * GET:    Fetch gallery of generated images (with optional tag/search filtering)
 * DELETE: Remove one or more generated images (blob + DB row)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sql } from '@/lib/db/sql';
import { del } from '@vercel/blob';

async function ensureDependentTables() {
    try {
        await sql`CREATE TABLE IF NOT EXISTS creative_image_tags (
            id SERIAL PRIMARY KEY, image_id TEXT NOT NULL, tag VARCHAR(100) NOT NULL, UNIQUE(image_id, tag))`;
        await sql`CREATE TABLE IF NOT EXISTS creative_post_usage (
            id SERIAL PRIMARY KEY, creative_image_id TEXT NOT NULL, content_post_id TEXT NOT NULL,
            platform VARCHAR(50), published_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(creative_image_id, content_post_id))`;
        await sql`ALTER TABLE creative_images ADD COLUMN IF NOT EXISTS group_id VARCHAR(100)`;
        await sql`ALTER TABLE creative_images ADD COLUMN IF NOT EXISTS variation_index INT DEFAULT 0`;
    } catch { /* tables may already exist */ }
}

/* ------------------------------------------------------------------ */
/*  GET - gallery with optional ?tag= and ?search= filters            */
/* ------------------------------------------------------------------ */
export async function GET(request: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await ensureDependentTables();

    const { searchParams } = new URL(request.url);
    const tag = searchParams.get('tag');
    const search = searchParams.get('search');

    try {
        let result;

        if (tag && search) {
            result = await sql`
                SELECT ci.id, ci.prompt, ci.enhanced_prompt, ci.style,
                       ci.aspect_ratio, ci.resolution, ci.blob_url,
                       ci.cost_time_ms, ci.created_by, ci.created_at,
                       ci.group_id, ci.variation_index,
                       COALESCE((SELECT json_agg(tag) FROM creative_image_tags WHERE image_id = ci.id), '[]') as tags,
                       COALESCE((SELECT json_agg(DISTINCT platform) FROM creative_post_usage WHERE creative_image_id = ci.id), '[]') as published_platforms
                FROM creative_images ci
                WHERE ci.status = 'success'
                  AND ci.blob_url IS NOT NULL
                  AND ci.prompt ILIKE '%' || ${search} || '%'
                  AND ci.id IN (SELECT image_id FROM creative_image_tags WHERE tag = ${tag})
                ORDER BY ci.created_at DESC
                LIMIT 200
            `;
        } else if (tag) {
            result = await sql`
                SELECT ci.id, ci.prompt, ci.enhanced_prompt, ci.style,
                       ci.aspect_ratio, ci.resolution, ci.blob_url,
                       ci.cost_time_ms, ci.created_by, ci.created_at,
                       ci.group_id, ci.variation_index,
                       COALESCE((SELECT json_agg(tag) FROM creative_image_tags WHERE image_id = ci.id), '[]') as tags,
                       COALESCE((SELECT json_agg(DISTINCT platform) FROM creative_post_usage WHERE creative_image_id = ci.id), '[]') as published_platforms
                FROM creative_images ci
                WHERE ci.status = 'success'
                  AND ci.blob_url IS NOT NULL
                  AND ci.id IN (SELECT image_id FROM creative_image_tags WHERE tag = ${tag})
                ORDER BY ci.created_at DESC
                LIMIT 200
            `;
        } else if (search) {
            result = await sql`
                SELECT ci.id, ci.prompt, ci.enhanced_prompt, ci.style,
                       ci.aspect_ratio, ci.resolution, ci.blob_url,
                       ci.cost_time_ms, ci.created_by, ci.created_at,
                       ci.group_id, ci.variation_index,
                       COALESCE((SELECT json_agg(tag) FROM creative_image_tags WHERE image_id = ci.id), '[]') as tags,
                       COALESCE((SELECT json_agg(DISTINCT platform) FROM creative_post_usage WHERE creative_image_id = ci.id), '[]') as published_platforms
                FROM creative_images ci
                WHERE ci.status = 'success'
                  AND ci.blob_url IS NOT NULL
                  AND ci.prompt ILIKE '%' || ${search} || '%'
                ORDER BY ci.created_at DESC
                LIMIT 200
            `;
        } else {
            result = await sql`
                SELECT ci.id, ci.prompt, ci.enhanced_prompt, ci.style,
                       ci.aspect_ratio, ci.resolution, ci.blob_url,
                       ci.cost_time_ms, ci.created_by, ci.created_at,
                       ci.group_id, ci.variation_index,
                       COALESCE((SELECT json_agg(tag) FROM creative_image_tags WHERE image_id = ci.id), '[]') as tags,
                       COALESCE((SELECT json_agg(DISTINCT platform) FROM creative_post_usage WHERE creative_image_id = ci.id), '[]') as published_platforms
                FROM creative_images ci
                WHERE ci.status = 'success'
                  AND ci.blob_url IS NOT NULL
                ORDER BY ci.created_at DESC
                LIMIT 200
            `;
        }

        const images = result.rows.map(row => ({
            id: row.id,
            prompt: row.prompt,
            enhancedPrompt: row.enhanced_prompt,
            style: row.style,
            aspectRatio: row.aspect_ratio,
            resolution: row.resolution,
            blobUrl: row.blob_url,
            costTimeMs: row.cost_time_ms,
            createdBy: row.created_by,
            createdAt: row.created_at?.toISOString(),
            groupId: row.group_id,
            variationIndex: row.variation_index,
            tags: row.tags ?? [],
            publishedPlatforms: row.published_platforms ?? [],
        }));

        return NextResponse.json({ images });
    } catch (error: unknown) {
        console.error('Creatives history error:', error);
        return NextResponse.json({ images: [] });
    }
}

/* ------------------------------------------------------------------ */
/*  DELETE - remove image(s) by id (single) or ids (bulk)             */
/* ------------------------------------------------------------------ */
export async function DELETE(request: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { searchParams } = new URL(request.url);
        const singleId = searchParams.get('id');
        let ids: string[] = [];

        if (singleId) {
            ids = [singleId];
        } else {
            const body = await request.json().catch(() => null);
            if (body?.ids && Array.isArray(body.ids)) {
                ids = body.ids.map(String);
            }
        }

        if (ids.length === 0) {
            return NextResponse.json(
                { error: 'Provide ?id=xxx or body { ids: [...] }' },
                { status: 400 },
            );
        }

        // Fetch blob URLs so we can delete from Vercel Blob
        const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
        const blobResult = await sql.query(
            `SELECT id, blob_url FROM creative_images WHERE id IN (${placeholders})`,
            ids,
        );

        const blobUrls: string[] = blobResult.rows
            .map(r => r.blob_url)
            .filter(Boolean);

        // Delete blobs
        if (blobUrls.length > 0) {
            await del(blobUrls);
        }

        // Delete tags first (no CASCADE)
        await sql.query(
            `DELETE FROM creative_image_tags WHERE image_id IN (${placeholders})`,
            ids,
        );

        // Delete usage records
        await sql.query(
            `DELETE FROM creative_post_usage WHERE creative_image_id IN (${placeholders})`,
            ids,
        );

        // Delete DB rows
        const deleteResult = await sql.query(
            `DELETE FROM creative_images WHERE id IN (${placeholders})`,
            ids,
        );

        return NextResponse.json({
            success: true,
            deleted: deleteResult.rowCount ?? 0,
        });
    } catch (error: unknown) {
        console.error('Creatives delete error:', error);
        return NextResponse.json(
            { error: 'Failed to delete image(s)' },
            { status: 500 },
        );
    }
}
