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
import { pgCacheGet } from '@/lib/pg-cache';
import sharp from 'sharp';

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

/** Overlay the real Chin Up logo onto the bottom-right of the generated image */
async function overlayLogo(imageBuffer: Buffer): Promise<Buffer> {
    try {
        // Fetch logo from public URL (filesystem not available on Vercel serverless)
        const baseUrl = process.env.NEXTAUTH_URL || process.env.VERCEL_URL
            ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3001';
        const logoUrl = `${baseUrl}/logo.png`;
        const logoRes = await fetch(logoUrl);
        if (!logoRes.ok) {
            console.error('[creatives/generate] Logo fetch failed:', logoRes.status);
            return imageBuffer;
        }
        const logoBuffer = Buffer.from(await logoRes.arrayBuffer());

        const image = sharp(imageBuffer);
        const metadata = await image.metadata();
        const imgWidth = metadata.width || 1024;
        const imgHeight = metadata.height || 1024;

        // Resize logo to ~18% of image width
        const logoWidth = Math.round(imgWidth * 0.18);
        const resizedLogo = await sharp(logoBuffer)
            .resize({ width: logoWidth })
            .png()
            .toBuffer();

        const logoMeta = await sharp(resizedLogo).metadata();
        const logoH = logoMeta.height || 60;

        // Composite logo in bottom-right with padding
        const result = await image
            .composite([{
                input: resizedLogo,
                top: imgHeight - logoH - Math.round(imgHeight * 0.03),
                left: imgWidth - logoWidth - Math.round(imgWidth * 0.03),
            }])
            .png()
            .toBuffer();

        return result;
    } catch (err) {
        console.error('[creatives/generate] Logo overlay failed, returning original:', err);
        return imageBuffer;
    }
}

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
    const { prompt, model, style, aspectRatio, resolution, referenceImageUrl, referenceImageUrls, includeBrandLogo, variations = 1, tags = [] } = body;

    if (!prompt || !style || !aspectRatio || !resolution) {
        return NextResponse.json({ error: 'Missing required fields: prompt, style, aspectRatio, resolution' }, { status: 400 });
    }

    // Support both legacy single URL and new multi-URL array
    const refUrls: string[] = referenceImageUrls?.length ? referenceImageUrls : (referenceImageUrl ? [referenceImageUrl] : []);

    const numVariations = Math.min(Math.max(1, Number(variations)), 3);

    try {
        await ensureCreativeImagesTable();

        // Fetch brand context from cached IG vision analysis
        let brandContext: string | undefined;
        let brandRefImages: string[] = [];
        try {
            // Try v2 (vision-based) first, fall back to v1 (caption-only)
            const profile = await pgCacheGet<{ promptEnhancement: string; referenceImageUrls?: string[] }>('brand_profile_v2')
                || await pgCacheGet<{ promptEnhancement: string; referenceImageUrls?: string[] }>('brand_profile');
            if (profile?.promptEnhancement) {
                brandContext = profile.promptEnhancement;
            }
            if (profile?.referenceImageUrls?.length) {
                brandRefImages = profile.referenceImageUrls;
            }
        } catch { /* no brand profile yet */ }

        // Auto-attach brand reference images if user didn't provide their own
        const effectiveRefUrls = refUrls.length > 0 ? refUrls : brandRefImages.slice(0, 3);

        const groupId = numVariations > 1 ? `group_${Date.now()}_${Math.random().toString(36).substr(2, 6)}` : null;
        const tasks: { id: string; taskId: string; enhancedPrompt: string }[] = [];

        for (let i = 0; i < numVariations; i++) {
            const varPrompt = i === 0 ? prompt : prompt + VARIATION_SUFFIXES[i];
            const generateReq: GenerateRequest = { prompt: varPrompt, model: model || 'nano-banana-pro', style, aspectRatio, resolution, referenceImageUrls: effectiveRefUrls, brandContext, includeBrandLogo: !!includeBrandLogo };

            const { taskId, enhancedPrompt } = await createImageTask(generateReq);
            const id = `creative_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

            await sql`
                INSERT INTO creative_images (id, prompt, enhanced_prompt, style, aspect_ratio, resolution, reference_image_url, task_id, status, created_by, group_id, variation_index)
                VALUES (${id}, ${prompt}, ${enhancedPrompt}, ${style}, ${aspectRatio}, ${resolution}, ${refUrls.length > 0 ? JSON.stringify(refUrls) : null}, ${taskId}, 'pending', ${session.user.email}, ${groupId}, ${i})
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
    const wantLogo = req.nextUrl.searchParams.get('logo') === '1';

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

            // Download from Kie.ai (URLs expire in 24h), optionally overlay logo, re-upload to Vercel Blob
            let blobUrl = taskStatus.imageUrl;
            try {
                const imageRes = await fetch(taskStatus.imageUrl);
                if (imageRes.ok) {
                    let imageBuffer: Buffer<ArrayBuffer> = Buffer.from(await imageRes.arrayBuffer());

                    // Overlay real Chin Up logo if requested
                    if (wantLogo) {
                        imageBuffer = Buffer.from(await overlayLogo(imageBuffer));
                    }

                    const blob = await put(`creatives/${id}.png`, imageBuffer, {
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
