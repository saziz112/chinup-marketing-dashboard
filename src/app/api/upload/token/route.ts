import { NextResponse } from 'next/server';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100 MB

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm'];
const ALLOWED_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES];

/**
 * POST /api/upload/token
 *
 * Handles Vercel Blob client-side upload token generation.
 * Files go directly from browser → Vercel Blob (bypasses 4.5MB serverless limit).
 */
export async function POST(req: Request) {
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await req.json()) as HandleUploadBody;

    try {
        const jsonResponse = await handleUpload({
            body,
            request: req,
            onBeforeGenerateToken: async (pathname) => {
                return {
                    allowedContentTypes: ALLOWED_TYPES,
                    maximumSizeInBytes: MAX_VIDEO_SIZE,
                    tokenPayload: JSON.stringify({
                        userId: (session.user as any)?.email || 'unknown',
                    }),
                };
            },
            onUploadCompleted: async ({ blob }) => {
                console.log(`[Upload] Client upload complete: ${blob.pathname} (${blob.url})`);
            },
        });

        return NextResponse.json(jsonResponse);
    } catch (error: any) {
        console.error('[Upload Token] Error:', error);
        return NextResponse.json({ error: error.message || 'Upload token generation failed' }, { status: 500 });
    }
}
