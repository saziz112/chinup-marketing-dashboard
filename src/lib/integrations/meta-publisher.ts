/**
 * Meta Publishing API Client
 *
 * Handles live publishing to Facebook Pages and Instagram Business accounts
 * using the Meta Graph API v21.0.
 *
 * Supported post types:
 *   Feed Post: standard photo/video/text posts
 *   Reel: short-form vertical video (IG Reels + FB Reels)
 *   Story: ephemeral content (disappears after 24h)
 *
 * Auto-resizes images for Instagram aspect ratio compliance.
 *
 * Requires: META_PAGE_ACCESS_TOKEN, META_PAGE_ID, META_IG_USER_ID
 */

import sharp from 'sharp';
import { put } from '@vercel/blob';

const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0';

// Instagram aspect ratio constraints (feed posts)
const IG_MIN_RATIO = 0.8;   // 4:5 portrait
const IG_MAX_RATIO = 1.91;  // 1.91:1 landscape

export type PostType = 'feed' | 'reel' | 'story';

function getEnv(key: string): string {
    const val = process.env[key];
    if (!val) throw new Error(`Missing env var: ${key}`);
    return val.trim();
}

function getOptionalEnv(key: string): string | null {
    return process.env[key]?.trim() || null;
}

/** Detect if a URL points to a video based on extension */
function isVideoUrl(url: string): boolean {
    const videoExtensions = ['.mp4', '.mov', '.avi', '.webm', '.mkv', '.m4v'];
    const lower = url.toLowerCase().split('?')[0];
    return videoExtensions.some(ext => lower.endsWith(ext));
}

// ─── Result Type ────────────────────────────────────────────────────────────

export interface PublishResult {
    success: boolean;
    postId?: string;
    error?: string;
    platform: 'facebook' | 'instagram';
}

// ─── Media Pre-flight Validation ────────────────────────────────────────────

/**
 * Quick pre-flight HEAD check. Returns { ok, contentType } so callers can fail
 * fast with a clear error instead of sending a dead URL to Meta and getting
 * back an opaque "Invalid parameter" / "Only photo or video accepted" error.
 */
async function preflightMedia(url: string): Promise<{ ok: true; contentType: string } | { ok: false; error: string }> {
    try {
        const res = await fetch(url, { method: 'HEAD' });
        if (!res.ok) {
            return { ok: false, error: `Media URL returned ${res.status} — it may have expired. Re-upload the file.` };
        }
        const contentType = (res.headers.get('content-type') || '').toLowerCase();
        if (!contentType) return { ok: true, contentType: '' };

        const okPrefix = contentType.startsWith('image/') || contentType.startsWith('video/');
        if (!okPrefix) {
            return { ok: false, error: `Media URL returned content-type "${contentType}" — expected image/* or video/*.` };
        }
        return { ok: true, contentType };
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown';
        return { ok: false, error: `Could not reach media URL (${msg}). Re-upload the file.` };
    }
}

/**
 * Fetch + normalize an image for Instagram. Always re-encodes to JPEG, caps the
 * longest side at 1440px, and crops if the aspect ratio falls outside 4:5 – 1.91:1.
 * Returns a fresh Vercel Blob URL.
 *
 * The short-circuit that returned the original URL for already-JPEG/PNG in-ratio
 * images was removed because it let through files that were technically valid
 * but exceeded Meta's unpublished limits (file size > 8MB, dimensions > 8192,
 * or Content-Type/magic-byte mismatches) — yielding "Only photo or video can be
 * accepted as media type" errors on the carousel child-container call.
 */
const IG_MAX_EDGE = 1440; // matches IG's 1440 recommended hi-res; well under their 8192 hard cap

async function prepareImageForInstagram(imageUrl: string, context: 'feed' | 'story' = 'feed'): Promise<string> {
    // Fast-path for stories: if the source is already a JPEG (matches extension
    // or content-type), keep the ORIGINAL URL. Meta's ingestion fetches images
    // from its own regions and has documented issues pulling freshly-created
    // Vercel Blob URLs (< a few seconds old) — returns
    // "Media download has failed. The media URI doesn't meet our requirements."
    // The original user-uploaded URL is already globally propagated because
    // it's been live since upload. Re-encoding is unnecessary for stories
    // since Meta accepts the full aspect range and we're not cropping.
    if (context === 'story') {
        const ext = imageUrl.toLowerCase().split('?')[0].split('.').pop();
        if (ext === 'jpg' || ext === 'jpeg') {
            try {
                const head = await fetch(imageUrl, { method: 'HEAD' });
                const ct = head.headers.get('content-type') || '';
                if (head.ok && ct.startsWith('image/jpeg')) {
                    console.log(`[IG Prepare] Story fast-path: using original URL ${imageUrl}`);
                    return imageUrl;
                }
            } catch { /* fall through to full pipeline */ }
        }
    }

    // Each stage is logged individually so Vercel logs pinpoint exactly where
    // this breaks (fetch vs sharp-decode vs sharp-encode vs blob-upload). The
    // function now throws on failure instead of falling back to the original
    // URL — a silent fallback masked a real pipeline break and let
    // out-of-aspect-ratio images reach Meta, triggering 'Only photo or video
    // can be accepted as media type'.
    const stage = { current: 'fetch' };
    try {
        const res = await fetch(imageUrl);
        if (!res.ok) throw new Error(`Fetch returned ${res.status}`);
        const buffer = Buffer.from(await res.arrayBuffer());

        stage.current = 'sharp-metadata';
        const metadata = await sharp(buffer).metadata();
        const { width, height, format } = metadata;
        if (!width || !height) throw new Error(`sharp could not read image dimensions (format=${format})`);

        const ratio = width / height;
        // Feed enforces 4:5–1.91:1. Stories accept a much wider range (Meta displays
        // at 9:16 with letterboxing) — cropping them to feed bounds is unnecessary
        // and arguably wrong, so skip it in the story context.
        const ratioOk = context === 'story'
            ? true
            : ratio >= IG_MIN_RATIO && ratio <= IG_MAX_RATIO;

        stage.current = 'sharp-pipeline';
        let pipeline = sharp(buffer);
        if (!ratioOk) {
            let cropWidth = width;
            let cropHeight = height;
            if (ratio > IG_MAX_RATIO) cropWidth = Math.round(height * IG_MAX_RATIO);
            else cropHeight = Math.round(width / IG_MIN_RATIO);
            const left = Math.round((width - cropWidth) / 2);
            const top = Math.round((height - cropHeight) / 2);
            pipeline = pipeline.extract({ left, top, width: cropWidth, height: cropHeight });
        }
        // toColourspace('srgb') forces CMYK / Adobe RGB / ProPhoto sources to sRGB;
        // Meta's IG ingestion rejects non-sRGB. flatten() drops alpha in case the
        // source was a PNG/TIFF with transparency, which would otherwise survive
        // into the JPEG as black artifacts Meta sometimes bails on.
        pipeline = pipeline
            .flatten({ background: '#ffffff' })
            .toColourspace('srgb')
            .resize({ width: IG_MAX_EDGE, height: IG_MAX_EDGE, fit: 'inside', withoutEnlargement: true });
        const processed = await pipeline
            .jpeg({ quality: 85, chromaSubsampling: '4:2:0', mozjpeg: false })
            .toBuffer();

        console.log(`[IG Prepare] ${format} ${width}x${height} → sRGB JPEG ${Math.round(processed.length / 1024)}KB (ratio ${ratio.toFixed(3)}, cropped=${!ratioOk})`);

        stage.current = 'blob-upload';
        const filename = `publish/ig_prepared_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
        const blob = await put(filename, processed, {
            access: 'public',
            addRandomSuffix: false,
            contentType: 'image/jpeg',
        });

        stage.current = 'blob-verify';
        // Vercel Blob can have a brief propagation lag. HEAD the URL up to 3 times
        // with 500ms backoff so we don't hand Meta a URL that's not yet live.
        let verified = false;
        for (let attempt = 0; attempt < 3; attempt++) {
            const head = await fetch(blob.url, { method: 'HEAD' });
            if (head.ok && head.headers.get('content-type')?.startsWith('image/')) {
                verified = true;
                break;
            }
            await new Promise(r => setTimeout(r, 500));
        }
        if (!verified) throw new Error(`Blob not reachable after upload: ${blob.url}`);

        console.log(`[IG Prepare] Uploaded + verified: ${blob.url}`);
        return blob.url;
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown';
        console.error(`[IG Prepare] FAILED at stage=${stage.current} for ${imageUrl}: ${msg}`);
        throw new Error(`Image preparation failed (stage: ${stage.current}): ${msg}`);
    }
}

// ─── Helper: Poll IG Container Status ───────────────────────────────────────

async function pollIGContainer(containerId: string, token: string, isVideo: boolean): Promise<string> {
    const maxAttempts = isVideo ? 30 : 10;
    const pollInterval = isVideo ? 5000 : 2000;
    let status = 'IN_PROGRESS';
    let attempts = 0;

    while (status === 'IN_PROGRESS' && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        const statusRes = await fetch(
            `${GRAPH_API_BASE}/${containerId}?fields=status_code&access_token=${token}`
        );
        const statusData = await statusRes.json();
        status = statusData.status_code || 'FINISHED';
        attempts++;
        console.log(`[Meta Publish IG] Container status: ${status} (attempt ${attempts}/${maxAttempts})`);
    }

    return status;
}

// ─── Helper: Publish IG Container ───────────────────────────────────────────

async function publishIGContainer(igUserId: string, containerId: string, token: string): Promise<PublishResult> {
    const publishRes = await fetch(`${GRAPH_API_BASE}/${igUserId}/media_publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creation_id: containerId, access_token: token }),
    });
    const publishData = await publishRes.json();

    if (publishData.error) {
        console.error('[Meta Publish IG] Publish error:', publishData.error);
        return { success: false, error: publishData.error.message, platform: 'instagram' };
    }

    console.log('[Meta Publish IG] Success:', publishData.id);
    return { success: true, postId: publishData.id, platform: 'instagram' };
}

// ═══════════════════════════════════════════════════════════════════════════
// FACEBOOK PUBLISHING
// ═══════════════════════════════════════════════════════════════════════════

/** Facebook Feed Post (text, photo, or video) */
export async function publishToFacebook(
    caption: string,
    mediaUrl?: string,
    mediaType?: 'photo' | 'video'
): Promise<PublishResult> {
    const pageId = getEnv('META_PAGE_ID');
    const token = getEnv('META_PAGE_ACCESS_TOKEN');

    try {
        let endpoint: string;
        let body: Record<string, string>;
        const isVideo = mediaType === 'video' || (mediaUrl && isVideoUrl(mediaUrl));

        if (mediaUrl && mediaUrl.startsWith('http') && isVideo) {
            endpoint = `${GRAPH_API_BASE}/${pageId}/videos`;
            body = { file_url: mediaUrl, description: caption, access_token: token };
        } else if (mediaUrl && mediaUrl.startsWith('http')) {
            endpoint = `${GRAPH_API_BASE}/${pageId}/photos`;
            body = { url: mediaUrl, message: caption, access_token: token };
        } else {
            endpoint = `${GRAPH_API_BASE}/${pageId}/feed`;
            body = { message: caption, access_token: token };
        }

        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json();

        if (data.error) {
            console.error('[Meta Publish FB] Error:', data.error);
            return { success: false, error: data.error.message, platform: 'facebook' };
        }

        console.log('[Meta Publish FB] Success:', data.id || data.post_id);
        return { success: true, postId: data.id || data.post_id, platform: 'facebook' };
    } catch (err: any) {
        console.error('[Meta Publish FB] Network error:', err);
        return { success: false, error: err.message, platform: 'facebook' };
    }
}

/**
 * Facebook Reel — 3-step process:
 * 1. POST /{page-id}/video_reels (upload_phase=start)
 * 2. POST rupload.facebook.com (upload video via file_url)
 * 3. POST /{page-id}/video_reels (upload_phase=finish, video_state=PUBLISHED)
 */
export async function publishFacebookReel(
    caption: string,
    videoUrl: string
): Promise<PublishResult> {
    const pageId = getEnv('META_PAGE_ID');
    const token = getEnv('META_PAGE_ACCESS_TOKEN');

    try {
        // Step 1: Initialize
        const initRes = await fetch(`${GRAPH_API_BASE}/${pageId}/video_reels`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ upload_phase: 'start', access_token: token }),
        });
        const initData = await initRes.json();

        if (initData.error) {
            return { success: false, error: initData.error.message, platform: 'facebook' };
        }

        const videoId = initData.video_id;
        if (!videoId) {
            return { success: false, error: 'No video_id returned from FB Reel init', platform: 'facebook' };
        }

        // Step 2: Upload via rupload
        const uploadRes = await fetch(`https://rupload.facebook.com/video-upload/v21.0/${videoId}`, {
            method: 'POST',
            headers: {
                'Authorization': `OAuth ${token}`,
                'file_url': videoUrl,
            },
        });
        const uploadData = await uploadRes.json();

        if (!uploadData.success) {
            return { success: false, error: 'Failed to upload video to Facebook', platform: 'facebook' };
        }

        // Step 3: Finish / Publish
        const finishRes = await fetch(`${GRAPH_API_BASE}/${pageId}/video_reels`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                upload_phase: 'finish',
                video_id: videoId,
                video_state: 'PUBLISHED',
                description: caption,
                access_token: token,
            }),
        });
        const finishData = await finishRes.json();

        if (finishData.error) {
            return { success: false, error: finishData.error.message, platform: 'facebook' };
        }

        console.log('[Meta Publish FB Reel] Success:', videoId);
        return { success: true, postId: videoId, platform: 'facebook' };
    } catch (err: any) {
        console.error('[Meta Publish FB Reel] Error:', err);
        return { success: false, error: err.message, platform: 'facebook' };
    }
}

/**
 * Facebook Story — photo or video
 * Photo: upload unpublished → POST /{page-id}/photo_stories
 * Video: 3-step via /{page-id}/video_stories
 */
export async function publishFacebookStory(
    mediaUrl: string,
    mediaType?: 'photo' | 'video'
): Promise<PublishResult> {
    const pageId = getEnv('META_PAGE_ID');
    const token = getEnv('META_PAGE_ACCESS_TOKEN');
    const isVideo = mediaType === 'video' || isVideoUrl(mediaUrl);

    const preflight = await preflightMedia(mediaUrl);
    if (!preflight.ok) {
        return { success: false, error: preflight.error, platform: 'facebook' };
    }

    try {
        if (isVideo) {
            // Video Story: 3-step
            const initRes = await fetch(`${GRAPH_API_BASE}/${pageId}/video_stories`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ upload_phase: 'start', access_token: token }),
            });
            const initData = await initRes.json();
            if (initData.error) {
                return { success: false, error: initData.error.message, platform: 'facebook' };
            }

            const videoId = initData.video_id;
            const uploadUrl = initData.upload_url;

            const uploadRes = await fetch(uploadUrl || `https://rupload.facebook.com/video-upload/v21.0/${videoId}`, {
                method: 'POST',
                headers: { 'Authorization': `OAuth ${token}`, 'file_url': mediaUrl },
            });
            const uploadData = await uploadRes.json();
            if (uploadData.error) {
                return { success: false, error: uploadData.error.message, platform: 'facebook' };
            }

            const finishRes = await fetch(`${GRAPH_API_BASE}/${pageId}/video_stories`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ upload_phase: 'finish', video_id: videoId, access_token: token }),
            });
            const finishData = await finishRes.json();
            if (finishData.error) {
                return { success: false, error: finishData.error.message, platform: 'facebook' };
            }

            console.log('[Meta Publish FB Story (video)] Success:', finishData.post_id || videoId);
            return { success: true, postId: finishData.post_id || videoId, platform: 'facebook' };
        } else {
            // Photo Story: 2-step
            const photoRes = await fetch(`${GRAPH_API_BASE}/${pageId}/photos`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: mediaUrl, published: 'false', access_token: token }),
            });
            const photoData = await photoRes.json();
            if (photoData.error) {
                return { success: false, error: photoData.error.message, platform: 'facebook' };
            }

            const storyRes = await fetch(`${GRAPH_API_BASE}/${pageId}/photo_stories`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ photo_id: photoData.id, access_token: token }),
            });
            const storyData = await storyRes.json();
            if (storyData.error) {
                return { success: false, error: storyData.error.message, platform: 'facebook' };
            }

            console.log('[Meta Publish FB Story (photo)] Success:', storyData.post_id || storyData.id);
            return { success: true, postId: storyData.post_id || storyData.id, platform: 'facebook' };
        }
    } catch (err: any) {
        console.error('[Meta Publish FB Story] Error:', err);
        return { success: false, error: err.message, platform: 'facebook' };
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// INSTAGRAM PUBLISHING
// ═══════════════════════════════════════════════════════════════════════════

/** Instagram Feed Post (photo or reel) */
export async function publishToInstagram(
    caption: string,
    mediaUrl: string,
    mediaType?: 'photo' | 'video'
): Promise<PublishResult> {
    const igUserId = getOptionalEnv('META_IG_USER_ID');
    const token = getOptionalEnv('META_PAGE_ACCESS_TOKEN');

    if (!igUserId || !token) {
        return { success: false, error: 'Instagram not configured. Set META_IG_USER_ID and META_PAGE_ACCESS_TOKEN.', platform: 'instagram' };
    }
    if (!mediaUrl || !mediaUrl.startsWith('http')) {
        return { success: false, error: 'Instagram requires media. Upload a file first.', platform: 'instagram' };
    }

    const isVideo = mediaType === 'video' || isVideoUrl(mediaUrl);

    const preflight = await preflightMedia(mediaUrl);
    if (!preflight.ok) {
        return { success: false, error: preflight.error, platform: 'instagram' };
    }

    try {
        let finalMediaUrl = mediaUrl;
        if (!isVideo) {
            finalMediaUrl = await prepareImageForInstagram(mediaUrl);
        }

        const containerBody: Record<string, string> = { caption, access_token: token };
        if (isVideo) {
            containerBody.video_url = finalMediaUrl;
            containerBody.media_type = 'REELS';
        } else {
            containerBody.image_url = finalMediaUrl;
        }

        const containerRes = await fetch(`${GRAPH_API_BASE}/${igUserId}/media`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(containerBody),
        });
        const containerData = await containerRes.json();

        if (containerData.error) {
            let errorMsg = containerData.error.message || 'Failed to create Instagram media container';
            if (errorMsg.toLowerCase().includes('aspect ratio')) {
                errorMsg += ' Instagram requires images between 4:5 (portrait) and 1.91:1 (landscape).';
            }
            return { success: false, error: errorMsg, platform: 'instagram' };
        }

        const containerId = containerData.id;
        if (!containerId) {
            return { success: false, error: 'No container ID returned from Instagram', platform: 'instagram' };
        }

        const status = await pollIGContainer(containerId, token, isVideo);
        if (status === 'ERROR') return { success: false, error: 'Instagram media processing failed.', platform: 'instagram' };
        if (status === 'IN_PROGRESS') return { success: false, error: 'Instagram is still processing. Try again.', platform: 'instagram' };

        return publishIGContainer(igUserId, containerId, token);
    } catch (err: any) {
        console.error('[Meta Publish IG] Network error:', err);
        return { success: false, error: err.message, platform: 'instagram' };
    }
}

/** Instagram Story — photo or video (media_type=STORIES). Caption is not displayed on IG Stories. */
export async function publishInstagramStory(
    _caption: string,
    mediaUrl: string,
    mediaType?: 'photo' | 'video'
): Promise<PublishResult> {
    const igUserId = getOptionalEnv('META_IG_USER_ID');
    const token = getOptionalEnv('META_PAGE_ACCESS_TOKEN');

    if (!igUserId || !token) {
        return { success: false, error: 'Instagram not configured.', platform: 'instagram' };
    }
    if (!mediaUrl || !mediaUrl.startsWith('http')) {
        return { success: false, error: 'Instagram Stories require media. Upload a file first.', platform: 'instagram' };
    }

    const isVideo = mediaType === 'video' || isVideoUrl(mediaUrl);

    // Pre-flight: confirm URL is reachable and is the right MIME class
    const preflight = await preflightMedia(mediaUrl);
    if (!preflight.ok) {
        return { success: false, error: preflight.error, platform: 'instagram' };
    }

    try {
        // IG Stories reject WebP and other non-JPEG/PNG formats — transcode if needed
        let finalMediaUrl = mediaUrl;
        if (!isVideo) finalMediaUrl = await prepareImageForInstagram(mediaUrl, 'story');

        const containerBody: Record<string, string> = { media_type: 'STORIES', access_token: token };
        if (isVideo) {
            containerBody.video_url = finalMediaUrl;
        } else {
            containerBody.image_url = finalMediaUrl;
        }

        console.log(`[Meta Publish IG Story] Creating ${isVideo ? 'video' : 'photo'} story container with url: ${finalMediaUrl}`);

        const containerRes = await fetch(`${GRAPH_API_BASE}/${igUserId}/media`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(containerBody),
        });
        const containerData = await containerRes.json();

        if (containerData.error) {
            console.error('[Meta Publish IG Story] Container error:', containerData.error, 'url was:', finalMediaUrl);
            return {
                success: false,
                error: `${containerData.error.message} [url: ${finalMediaUrl}]`,
                platform: 'instagram',
            };
        }

        const containerId = containerData.id;
        if (!containerId) {
            return { success: false, error: 'No container ID for IG Story', platform: 'instagram' };
        }

        const status = await pollIGContainer(containerId, token, isVideo);
        if (status === 'ERROR') return { success: false, error: 'Instagram Story processing failed.', platform: 'instagram' };
        if (status === 'IN_PROGRESS') return { success: false, error: 'Still processing. Try again shortly.', platform: 'instagram' };

        return publishIGContainer(igUserId, containerId, token);
    } catch (err: any) {
        console.error('[Meta Publish IG Story] Error:', err);
        return { success: false, error: err.message, platform: 'instagram' };
    }
}

/**
 * Instagram multi-story — a "story carousel" is actually N separate stories
 * published back-to-back. IG's Story API is single-media; the feed-Carousel
 * API (media_type=CAROUSEL) is NOT for stories and rejects with 'Only photo
 * or video can be accepted as media type' if you try. This helper publishes
 * each URL as its own story sequentially and returns a combined result.
 */
export async function publishInstagramStoryMulti(
    caption: string,
    mediaUrls: string[],
    mediaType?: 'photo' | 'video',
): Promise<PublishResult> {
    if (mediaUrls.length === 0) {
        return { success: false, error: 'At least one media required for story.', platform: 'instagram' };
    }
    const postIds: string[] = [];
    for (let i = 0; i < mediaUrls.length; i++) {
        const r = await publishInstagramStory(caption, mediaUrls[i], mediaType);
        if (!r.success) {
            return {
                success: false,
                error: `Story ${i + 1}/${mediaUrls.length} failed: ${r.error}`,
                platform: 'instagram',
            };
        }
        if (r.postId) postIds.push(r.postId);
    }
    return { success: true, postId: postIds.join(','), platform: 'instagram' };
}

/**
 * Facebook multi-story — same idea as IG: FB Stories are single-media.
 * publishFacebookMultiPhoto creates a FEED post with attached media, which
 * is not what the user wants when they pick 'Story'.
 */
export async function publishFacebookStoryMulti(
    mediaUrls: string[],
    mediaType?: 'photo' | 'video',
): Promise<PublishResult> {
    if (mediaUrls.length === 0) {
        return { success: false, error: 'At least one media required for story.', platform: 'facebook' };
    }
    const postIds: string[] = [];
    for (let i = 0; i < mediaUrls.length; i++) {
        const r = await publishFacebookStory(mediaUrls[i], mediaType);
        if (!r.success) {
            return {
                success: false,
                error: `Story ${i + 1}/${mediaUrls.length} failed: ${r.error}`,
                platform: 'facebook',
            };
        }
        if (r.postId) postIds.push(r.postId);
    }
    return { success: true, postId: postIds.join(','), platform: 'facebook' };
}

// ═══════════════════════════════════════════════════════════════════════════
// INSTAGRAM CAROUSEL (up to 10 images)
// ═══════════════════════════════════════════════════════════════════════════

/** Instagram Carousel — multi-image post (2-10 images) */
export async function publishInstagramCarousel(
    caption: string,
    imageUrls: string[],
): Promise<PublishResult> {
    const igUserId = getOptionalEnv('META_IG_USER_ID');
    const token = getOptionalEnv('META_PAGE_ACCESS_TOKEN');

    if (!igUserId || !token) {
        return { success: false, error: 'Instagram not configured.', platform: 'instagram' };
    }
    if (imageUrls.length < 2) {
        return { success: false, error: 'Carousel requires at least 2 images.', platform: 'instagram' };
    }
    if (imageUrls.length > 10) {
        return { success: false, error: 'Carousel supports max 10 images.', platform: 'instagram' };
    }

    try {
        // Step 1: Create child containers for each image
        const childIds: string[] = [];
        for (let i = 0; i < imageUrls.length; i++) {
            const url = imageUrls[i];
            const resizedUrl = await prepareImageForInstagram(url);
            console.log(`[Meta Publish IG Carousel] Child ${i + 1}/${imageUrls.length} prepared: ${resizedUrl}`);
            const childRes = await fetch(`${GRAPH_API_BASE}/${igUserId}/media`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    image_url: resizedUrl,
                    is_carousel_item: true,
                    access_token: token,
                }),
            });
            const childData = await childRes.json();
            if (childData.error) {
                console.error(`[Meta Publish IG Carousel] Child ${i + 1}/${imageUrls.length} error:`, childData.error, 'url was:', resizedUrl);
                return {
                    success: false,
                    error: `Carousel image ${i + 1}/${imageUrls.length} failed: ${childData.error.message}`,
                    platform: 'instagram',
                };
            }
            if (!childData.id) {
                return { success: false, error: `No container ID for carousel image ${i + 1}/${imageUrls.length}`, platform: 'instagram' };
            }
            childIds.push(childData.id);
        }

        // Step 2: Create carousel container
        const carouselRes = await fetch(`${GRAPH_API_BASE}/${igUserId}/media`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                media_type: 'CAROUSEL',
                children: childIds.join(','),
                caption,
                access_token: token,
            }),
        });
        const carouselData = await carouselRes.json();

        if (carouselData.error) {
            console.error('[Meta Publish IG Carousel] Carousel container error:', carouselData.error);
            return { success: false, error: carouselData.error.message, platform: 'instagram' };
        }

        const containerId = carouselData.id;
        if (!containerId) {
            return { success: false, error: 'No carousel container ID returned', platform: 'instagram' };
        }

        // Step 3: Poll container status
        const status = await pollIGContainer(containerId, token, false);
        if (status === 'ERROR') return { success: false, error: 'Instagram carousel processing failed.', platform: 'instagram' };
        if (status === 'IN_PROGRESS') return { success: false, error: 'Instagram carousel still processing.', platform: 'instagram' };

        // Step 4: Publish
        return publishIGContainer(igUserId, containerId, token);
    } catch (err: any) {
        console.error('[Meta Publish IG Carousel] Error:', err);
        return { success: false, error: err.message, platform: 'instagram' };
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// FACEBOOK MULTI-PHOTO POST
// ═══════════════════════════════════════════════════════════════════════════

/** Facebook Multi-Photo Post — upload each as unpublished, then combine */
export async function publishFacebookMultiPhoto(
    caption: string,
    imageUrls: string[],
): Promise<PublishResult> {
    const pageId = getEnv('META_PAGE_ID');
    const token = getEnv('META_PAGE_ACCESS_TOKEN');

    if (imageUrls.length < 2) {
        return { success: false, error: 'Multi-photo post requires at least 2 images.', platform: 'facebook' };
    }

    try {
        // Step 1: Upload each photo as unpublished
        const mediaFbIds: string[] = [];
        for (const url of imageUrls) {
            const photoRes = await fetch(`${GRAPH_API_BASE}/${pageId}/photos`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url,
                    published: false,
                    access_token: token,
                }),
            });
            const photoData = await photoRes.json();
            if (photoData.error) {
                console.error('[Meta Publish FB Multi] Photo upload error:', photoData.error);
                return { success: false, error: `Photo upload failed: ${photoData.error.message}`, platform: 'facebook' };
            }
            if (!photoData.id) {
                return { success: false, error: 'No photo ID returned from Facebook', platform: 'facebook' };
            }
            mediaFbIds.push(photoData.id);
        }

        // Step 2: Create multi-photo post with attached_media
        // Facebook Graph API requires attached_media as indexed form fields,
        // not a JSON array — JSON format silently fails or errors.
        const params = new URLSearchParams();
        params.append('message', caption);
        params.append('access_token', token);
        for (let i = 0; i < mediaFbIds.length; i++) {
            params.append(`attached_media[${i}]`, JSON.stringify({ media_fbid: mediaFbIds[i] }));
        }
        const postRes = await fetch(`${GRAPH_API_BASE}/${pageId}/feed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
        });
        const postData = await postRes.json();

        if (postData.error) {
            console.error('[Meta Publish FB Multi] Post error:', postData.error);
            return { success: false, error: postData.error.message, platform: 'facebook' };
        }

        console.log('[Meta Publish FB Multi] Success:', postData.id);
        return { success: true, postId: postData.id, platform: 'facebook' };
    } catch (err: any) {
        console.error('[Meta Publish FB Multi] Error:', err);
        return { success: false, error: err.message, platform: 'facebook' };
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// MULTI-PLATFORM PUBLISH
// ═══════════════════════════════════════════════════════════════════════════

/** True if an error message matches Meta's generic transient error pattern. */
function isTransientMetaError(error: string | undefined): boolean {
    if (!error) return false;
    const lower = error.toLowerCase();
    return lower.includes('unexpected error has occurred') && lower.includes('please retry');
}

/**
 * Wrapper around publishToMultiplePlatforms that auto-retries ONCE for any
 * platform that returned a transient Meta error. Covers the bulk of historical
 * failures on IG carousels where Meta returns "unexpected error, please retry".
 */
export async function publishWithTransientRetry(
    platforms: string[],
    caption: string,
    mediaUrls?: string | string[],
    mediaType?: 'photo' | 'video',
    postType: PostType = 'feed',
    gbpLocations?: string[],
): Promise<PublishResult[]> {
    const results = await publishToMultiplePlatforms(platforms, caption, mediaUrls, mediaType, postType, gbpLocations);

    const transientIndices: number[] = [];
    for (let i = 0; i < results.length; i++) {
        if (!results[i].success && isTransientMetaError(results[i].error)) {
            transientIndices.push(i);
        }
    }
    if (transientIndices.length === 0) return results;

    const retryPlatforms = transientIndices.map(i => platforms[i]);
    console.log(`[Publish Retry] Auto-retrying ${retryPlatforms.length} transient Meta failure(s): ${retryPlatforms.join(', ')}`);

    // 10s delay — Meta's carousel item endpoint sometimes needs tens of seconds to
    // shake off a transient; 3s wasn't long enough in practice. Still fits inside
    // the 60s function cap for a 6-image carousel.
    await new Promise(r => setTimeout(r, 10000));

    const retryResults = await publishToMultiplePlatforms(retryPlatforms, caption, mediaUrls, mediaType, postType, gbpLocations);

    const merged = [...results];
    for (let i = 0; i < transientIndices.length; i++) {
        merged[transientIndices[i]] = retryResults[i];
    }
    return merged;
}

export async function publishToMultiplePlatforms(
    platforms: string[],
    caption: string,
    mediaUrls?: string | string[],
    mediaType?: 'photo' | 'video',
    postType: PostType = 'feed',
    gbpLocations?: string[],
): Promise<PublishResult[]> {
    // Normalize mediaUrls to array
    const urls: string[] = Array.isArray(mediaUrls) ? mediaUrls : mediaUrls ? [mediaUrls] : [];
    const mediaUrl = urls[0] || undefined;
    const isCarousel = urls.length > 1;
    const results: PublishResult[] = [];

    const tasks = platforms.map(async (platform) => {
        if (platform === 'facebook') {
            // Story intent takes precedence over multi-image: a "story carousel"
            // is N separate stories, not a feed multi-photo post.
            if (postType === 'story') {
                if (isCarousel) return publishFacebookStoryMulti(urls, mediaType);
                if (!mediaUrl) return { success: false, error: 'Facebook Stories require media.', platform: 'facebook' as const };
                return publishFacebookStory(mediaUrl, mediaType);
            }
            if (isCarousel) {
                return publishFacebookMultiPhoto(caption, urls);
            }
            if (postType === 'reel') {
                if (!mediaUrl) return { success: false, error: 'Facebook Reels require a video.', platform: 'facebook' as const };
                return publishFacebookReel(caption, mediaUrl);
            }
            return publishToFacebook(caption, mediaUrl, mediaType);
        }

        if (platform === 'instagram') {
            // Story intent takes precedence over multi-image: a "story carousel"
            // is N separate stories, not a feed carousel post.
            if (postType === 'story') {
                if (isCarousel) return publishInstagramStoryMulti(caption, urls, mediaType);
                if (!mediaUrl || !mediaUrl.startsWith('http')) {
                    return { success: false, error: 'Instagram requires media. Upload a file first.', platform: 'instagram' as const };
                }
                return publishInstagramStory(caption, mediaUrl, mediaType);
            }
            if (isCarousel) {
                return publishInstagramCarousel(caption, urls);
            }
            if (!mediaUrl || !mediaUrl.startsWith('http')) {
                return { success: false, error: 'Instagram requires media. Upload a file first.', platform: 'instagram' as const };
            }
            return publishToInstagram(caption, mediaUrl, mediaType);
        }

        if (platform === 'google-business') {
            try {
                const { publishToGoogleBusiness } = await import('@/lib/integrations/google-business-publisher');
                const locations = gbpLocations && gbpLocations.length > 0
                    ? gbpLocations
                    : ['decatur', 'smyrna', 'kennesaw']; // Default: all locations (cron fallback)
                const gbpResults = await publishToGoogleBusiness(
                    caption,
                    locations,
                    mediaUrl,
                );
                // Return first result as representative
                const anySuccess = gbpResults.some(r => r.success);
                const errors = gbpResults.filter(r => !r.success).map(r => `${r.locationName}: ${r.error}`);
                return {
                    success: anySuccess,
                    postId: gbpResults.find(r => r.success)?.postId,
                    error: errors.length > 0 ? errors.join('; ') : undefined,
                    platform: 'facebook' as const, // PublishResult type constraint
                };
            } catch (err) {
                return {
                    success: false,
                    error: err instanceof Error ? err.message : 'GBP publishing failed',
                    platform: 'facebook' as const,
                };
            }
        }

        if (platform === 'youtube') {
            return {
                success: false,
                error: 'YouTube publishing is not yet supported. Upload videos directly to YouTube Studio.',
                platform: 'youtube' as unknown as 'facebook',
            };
        }

        return { success: false, error: `Unknown platform: ${platform}`, platform: platform as 'facebook' };
    });

    const settled = await Promise.allSettled(tasks);
    for (const r of settled) {
        if (r.status === 'fulfilled') {
            results.push(r.value);
        } else {
            results.push({ success: false, error: r.reason?.message || 'Unknown error', platform: 'facebook' });
        }
    }

    return results;
}
