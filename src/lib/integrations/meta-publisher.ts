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

// ─── Instagram Image Auto-Resize ────────────────────────────────────────────

async function ensureInstagramAspectRatio(imageUrl: string): Promise<string> {
    try {
        const res = await fetch(imageUrl);
        if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
        const buffer = Buffer.from(await res.arrayBuffer());

        const metadata = await sharp(buffer).metadata();
        const { width, height } = metadata;
        if (!width || !height) return imageUrl;

        const ratio = width / height;
        console.log(`[IG Resize] Image ${width}x${height}, ratio ${ratio.toFixed(3)} (valid: ${IG_MIN_RATIO}-${IG_MAX_RATIO})`);

        if (ratio >= IG_MIN_RATIO && ratio <= IG_MAX_RATIO) return imageUrl;

        let cropWidth = width;
        let cropHeight = height;

        if (ratio > IG_MAX_RATIO) {
            cropWidth = Math.round(height * IG_MAX_RATIO);
        } else {
            cropHeight = Math.round(width / IG_MIN_RATIO);
        }

        const left = Math.round((width - cropWidth) / 2);
        const top = Math.round((height - cropHeight) / 2);

        console.log(`[IG Resize] Cropping to ${cropWidth}x${cropHeight} (from ${width}x${height})`);

        const cropped = await sharp(buffer)
            .extract({ left, top, width: cropWidth, height: cropHeight })
            .jpeg({ quality: 92 })
            .toBuffer();

        const filename = `publish/ig_cropped_${Date.now()}.jpg`;
        const blob = await put(filename, cropped, {
            access: 'public',
            addRandomSuffix: false,
            contentType: 'image/jpeg',
        });

        console.log(`[IG Resize] Cropped image uploaded: ${blob.url}`);
        return blob.url;
    } catch (err: any) {
        console.error('[IG Resize] Error:', err.message);
        return imageUrl;
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

    try {
        let finalMediaUrl = mediaUrl;
        if (!isVideo) {
            finalMediaUrl = await ensureInstagramAspectRatio(mediaUrl);
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

/** Instagram Story — photo or video (media_type=STORIES) */
export async function publishInstagramStory(
    caption: string,
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

    try {
        const containerBody: Record<string, string> = { media_type: 'STORIES', access_token: token };
        if (isVideo) {
            containerBody.video_url = mediaUrl;
        } else {
            containerBody.image_url = mediaUrl;
        }

        console.log(`[Meta Publish IG Story] Creating ${isVideo ? 'video' : 'photo'} story container`);

        const containerRes = await fetch(`${GRAPH_API_BASE}/${igUserId}/media`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(containerBody),
        });
        const containerData = await containerRes.json();

        if (containerData.error) {
            return { success: false, error: containerData.error.message, platform: 'instagram' };
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
        for (const url of imageUrls) {
            const resizedUrl = await ensureInstagramAspectRatio(url);
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
                console.error('[Meta Publish IG Carousel] Child container error:', childData.error);
                return { success: false, error: `Carousel image failed: ${childData.error.message}`, platform: 'instagram' };
            }
            if (!childData.id) {
                return { success: false, error: 'No container ID for carousel image', platform: 'instagram' };
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
            if (isCarousel) {
                return publishFacebookMultiPhoto(caption, urls);
            }
            if (postType === 'reel') {
                if (!mediaUrl) return { success: false, error: 'Facebook Reels require a video.', platform: 'facebook' as const };
                return publishFacebookReel(caption, mediaUrl);
            }
            if (postType === 'story') {
                if (!mediaUrl) return { success: false, error: 'Facebook Stories require media.', platform: 'facebook' as const };
                return publishFacebookStory(mediaUrl, mediaType);
            }
            return publishToFacebook(caption, mediaUrl, mediaType);
        }

        if (platform === 'instagram') {
            if (isCarousel) {
                return publishInstagramCarousel(caption, urls);
            }
            if (!mediaUrl || !mediaUrl.startsWith('http')) {
                return { success: false, error: 'Instagram requires media. Upload a file first.', platform: 'instagram' as const };
            }
            if (postType === 'story') {
                return publishInstagramStory(caption, mediaUrl, mediaType);
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
