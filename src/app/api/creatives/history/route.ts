/**
 * /api/creatives/history
 * GET: Fetch gallery of generated images
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sql } from '@vercel/postgres';

export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const result = await sql`
            SELECT id, prompt, enhanced_prompt, style, aspect_ratio, resolution,
                   blob_url, cost_time_ms, created_by, created_at
            FROM creative_images
            WHERE status = 'success' AND blob_url IS NOT NULL
            ORDER BY created_at DESC
            LIMIT 50
        `;

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
        }));

        return NextResponse.json({ images });
    } catch (error: unknown) {
        console.error('Creatives history error:', error);
        // Return empty array if table doesn't exist yet
        return NextResponse.json({ images: [] });
    }
}
