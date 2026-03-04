import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

// Max file sizes
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100 MB

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm'];
const ALLOWED_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES];

/**
 * POST /api/upload
 * 
 * Accepts a file via FormData and uploads it to Vercel Blob.
 * Returns a public URL that can be used with Meta APIs.
 * 
 * Body: FormData with 'file' field
 * Returns: { url: string, contentType: string, mediaType: 'photo' | 'video', size: number }
 */
export async function POST(req: Request) {
    // Auth check
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const formData = await req.formData();
        const file = formData.get('file') as File | null;

        if (!file) {
            return NextResponse.json({ error: 'No file provided' }, { status: 400 });
        }

        // Validate file type
        if (!ALLOWED_TYPES.includes(file.type)) {
            return NextResponse.json({
                error: `Unsupported file type: ${file.type}. Supported: JPG, PNG, GIF, WebP, MP4, MOV, AVI, WebM.`,
            }, { status: 400 });
        }

        // Determine media type
        const isVideo = ALLOWED_VIDEO_TYPES.includes(file.type);
        const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;

        // Validate file size
        if (file.size > maxSize) {
            const maxMB = Math.round(maxSize / (1024 * 1024));
            return NextResponse.json({
                error: `File too large (${Math.round(file.size / (1024 * 1024))}MB). Max: ${maxMB}MB for ${isVideo ? 'videos' : 'images'}.`,
            }, { status: 400 });
        }

        // Generate a clean filename with timestamp to avoid collisions
        const ext = file.name.split('.').pop() || (isVideo ? 'mp4' : 'jpg');
        const cleanName = file.name
            .replace(/\.[^/.]+$/, '') // remove extension
            .replace(/[^a-zA-Z0-9-_]/g, '_') // sanitize
            .substring(0, 50); // limit length
        const filename = `publish/${cleanName}_${Date.now()}.${ext}`;

        // Upload to Vercel Blob
        const blob = await put(filename, file, {
            access: 'public',
            addRandomSuffix: false, // we already added timestamp
            contentType: file.type,
        });

        console.log(`[Upload] Uploaded ${file.name} (${Math.round(file.size / 1024)}KB) → ${blob.url}`);

        return NextResponse.json({
            url: blob.url,
            contentType: file.type,
            mediaType: isVideo ? 'video' : 'photo',
            size: file.size,
        });

    } catch (error: any) {
        console.error('[Upload] Error:', error);

        // Handle Vercel Blob specific errors
        if (error.message?.includes('BLOB_READ_WRITE_TOKEN')) {
            return NextResponse.json({
                error: 'Vercel Blob not configured. Go to Vercel Dashboard → Storage → Create Blob Store.',
            }, { status: 500 });
        }

        return NextResponse.json({ error: error.message || 'Upload failed' }, { status: 500 });
    }
}
