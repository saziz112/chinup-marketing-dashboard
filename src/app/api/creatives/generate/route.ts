/**
 * /api/creatives/generate
 * POST: Create image generation task(s) — supports 1-3 variations
 * GET:  Poll task status (returns image URL when done)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createImageTask, getTaskStatus, isKieAiConfigured, type GenerateRequest } from '@/lib/integrations/kie-ai';
import { sql } from '@vercel/postgres';
import { put } from '@vercel/blob';

async function ensureCreativeImagesTable() {
    try {
        await sql`
            CREATE TABLE IF NOT EXISTS creative_images (
                id TEXT PRIMARY KEY,
                prompt TEXT NOT NULL,
                enhanced_prompt TEXT,
                style VARCHAR(50),
                aspect_ratio VARCHAR(20),
                resolution VARCHAR(10),
                reference_image_url TEXT,
                task_id VARCHAR(100),
                status VARCHAR(20) NOT NULL DEFAULT 'pending',
                image_url TEXT,
                blob_url TEXT,
                fail_msg TEXT,
                cost_time_ms INT,
                created_by VARCHAR(255),
                created_at TIMESTAMPTZ DEFAULT NOW(),
                completed_at TIMESTAMPTZ
            )
        `;
        await sql`ALTER TABLE creative_images ADD COLUMN IF NOT EXISTS group_id VARCHAR(100)`;
        await sql`ALTER TABLE creative_images ADD COLUMN IF NOT EXISTS variation_index INT DEFAULT 0`;
    } catch {
        // Table may already exist
    }
}

const VARIATION_SUFFIXES = [
    '',
    ', alternative composition and angle',
    ', different perspective and framing',
];

// POST: Start image generation (1-3 variations)
export async function POST(req: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isKieAiConfigured()) {
        return NextResponse.json({ error: 'Kie.ai API key not configured' }, { status: 503 });
    }

    const body = await req.json();
    const { prompt, style, aspectRatio, resolution, referenceImageUrl, variations = 1, tags = [] } = body;

    if (!prompt || !style || !aspectRatio || !resolution) {
        return NextResponse.json({ error: 'Missing required fields: prompt, style, aspectRatio, resolution' }, { status: 400 });
    }

    const numVariations = Math.min(Math.max(1, Number(variations)), 3);

    try {
        await ensureCreativeImagesTable();

        const groupId = numVariations > 1 ? `group_${Date.now()}_${Math.random().toString(36).substr(2, 6)}` : null;
        const tasks: { id: string; taskId: string; enhancedPrompt: string }[] = [];

        for (let i = 0; i < numVariations; i++) {
            const varPrompt = i === 0 ? prompt : prompt + VARIATION_SUFFIXES[i];
            const generateReq: GenerateRequest = { prompt: varPrompt, style, aspectRatio, resolution, referenceImageUrl };

            const { taskId, enhancedPrompt } = await createImageTask(generateReq);
            const id = `creative_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

            await sql`
                INSERT INTO creative_images (id, prompt, enhanced_prompt, style, aspect_ratio, resolution, reference_image_url, task_id, status, created_by, group_id, variation_index)
                VALUES (${id}, ${prompt}, ${enhancedPrompt}, ${style}, ${aspectRatio}, ${resolution}, ${referenceImageUrl || null}, ${taskId}, 'pending', ${session.user.email}, ${groupId}, ${i})
            `;

            // Insert tags
            const tagArr: string[] = Array.isArray(tags) ? tags : [];
            for (const tag of tagArr) {
                const cleaned = String(tag).trim().toLowerCase();
                if (cleaned) {
                    try {
                        await sql`INSERT INTO creative_image_tags (image_id, tag) VALUES (${id}, ${cleaned}) ON CONFLICT DO NOTHING`;
                    } catch { /* ignore duplicate */ }
                }
            }

            tasks.push({ id, taskId, enhancedPrompt });

            // Small delay between API calls to avoid rate limiting
            if (i < numVariations - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        if (numVariations === 1) {
            // Single image — backward compatible response
            return NextResponse.json({
                id: tasks[0].id,
                taskId: tasks[0].taskId,
                enhancedPrompt: tasks[0].enhancedPrompt,
                status: 'pending',
            });
        }

        // Multiple variations
        return NextResponse.json({
            tasks: tasks.map(t => ({ id: t.id, taskId: t.taskId, enhancedPrompt: t.enhancedPrompt })),
            groupId,
            status: 'pending',
        });
    } catch (error: unknown) {
        console.error('Creatives generate error:', error);
        const message = error instanceof Error ? error.message : 'Generation failed';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

// GET: Poll task status
export async function GET(req: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const taskId = req.nextUrl.searchParams.get('taskId');
    const id = req.nextUrl.searchParams.get('id');

    if (!taskId || !id) {
        return NextResponse.json({ error: 'Missing taskId or id' }, { status: 400 });
    }

    try {
        const taskStatus = await getTaskStatus(taskId);
        console.log('[creatives/generate GET] taskStatus:', JSON.stringify(taskStatus));

        if (taskStatus.status === 'success') {
            if (!taskStatus.imageUrl) {
                console.error('[creatives/generate GET] Success but no imageUrl! Full status:', JSON.stringify(taskStatus));
                return NextResponse.json({
                    status: 'failed',
                    error: 'Image generated but URL could not be extracted. Check server logs.',
                });
            }

            // Download from Kie.ai (URLs expire in 24h) and re-upload to Vercel Blob
            let blobUrl = taskStatus.imageUrl;
            try {
                const imageRes = await fetch(taskStatus.imageUrl);
                if (imageRes.ok) {
                    const imageBuffer = await imageRes.arrayBuffer();
                    const blob = await put(`creatives/${id}.png`, Buffer.from(imageBuffer), {
                        access: 'public',
                        contentType: 'image/png',
                    });
                    blobUrl = blob.url;
                } else {
                    console.error('[creatives/generate GET] Image download failed:', imageRes.status, imageRes.statusText);
                }
            } catch (uploadErr) {
                console.error('[creatives/generate GET] Blob upload failed, using Kie.ai URL:', uploadErr);
            }

            // Update DB
            await sql`
                UPDATE creative_images
                SET status = 'success', image_url = ${taskStatus.imageUrl}, blob_url = ${blobUrl},
                    cost_time_ms = ${taskStatus.costTimeMs || null}, completed_at = NOW()
                WHERE id = ${id}
            `;

            return NextResponse.json({ status: 'success', blobUrl, costTimeMs: taskStatus.costTimeMs });
        }

        if (taskStatus.status === 'failed') {
            await sql`
                UPDATE creative_images
                SET status = 'failed', fail_msg = ${taskStatus.failMsg || 'Generation failed'}, completed_at = NOW()
                WHERE id = ${id}
            `;
            return NextResponse.json({ status: 'failed', error: taskStatus.failMsg });
        }

        // Still processing
        return NextResponse.json({ status: taskStatus.status });
    } catch (error: unknown) {
        console.error('[creatives/generate GET] Poll error:', error);
        const message = error instanceof Error ? error.message : 'Poll failed';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
