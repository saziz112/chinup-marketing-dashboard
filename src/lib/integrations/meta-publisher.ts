/**
 * Meta Publishing API Client
 * 
 * Handles live publishing to Facebook Pages and Instagram Business accounts
 * using the Meta Graph API v21.0.
 * 
 * Facebook:
 *   - Text: POST /{page-id}/feed
 *   - Photo: POST /{page-id}/photos (url param)
 *   - Video: POST /{page-id}/videos (file_url param)
 * 
 * Instagram (two-step container API):
 *   - Photo: POST /{ig-user-id}/media (image_url) → media_publish
 *   - Reel:  POST /{ig-user-id}/media (video_url + media_type=REELS) → media_publish
 * 
 * Requires: META_PAGE_ACCESS_TOKEN, META_PAGE_ID, META_IG_USER_ID
 */

const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0';

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
    const lower = url.toLowerCase().split('?')[0]; // ignore query params
    return videoExtensions.some(ext => lower.endsWith(ext));
}

// ─── Result Type ────────────────────────────────────────────────────────────

export interface PublishResult {
    success: boolean;
    postId?: string;
    error?: string;
    platform: 'facebook' | 'instagram';
}

// ─── Facebook Page Publishing ───────────────────────────────────────────────

/**
 * Publish a post to the Facebook Page.
 * 
 * - Text-only: POST /{page-id}/feed with message
 * - Image + text: POST /{page-id}/photos with url + message
 * - Video + text: POST /{page-id}/videos with file_url + description
 */
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
            // Video post
            endpoint = `${GRAPH_API_BASE}/${pageId}/videos`;
            body = {
                file_url: mediaUrl,
                description: caption,
                access_token: token,
            };
        } else if (mediaUrl && mediaUrl.startsWith('http')) {
            // Image post
            endpoint = `${GRAPH_API_BASE}/${pageId}/photos`;
            body = {
                url: mediaUrl,
                message: caption,
                access_token: token,
            };
        } else {
            // Text-only post
            endpoint = `${GRAPH_API_BASE}/${pageId}/feed`;
            body = {
                message: caption,
                access_token: token,
            };
        }

        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        const data = await res.json();

        if (data.error) {
            console.error('[Meta Publish FB] Error:', data.error);
            return {
                success: false,
                error: data.error.message || 'Unknown Facebook publishing error',
                platform: 'facebook',
            };
        }

        console.log('[Meta Publish FB] Success:', data.id || data.post_id);
        return {
            success: true,
            postId: data.id || data.post_id,
            platform: 'facebook',
        };
    } catch (err: any) {
        console.error('[Meta Publish FB] Network error:', err);
        return {
            success: false,
            error: err.message || 'Network error publishing to Facebook',
            platform: 'facebook',
        };
    }
}

// ─── Instagram Publishing ───────────────────────────────────────────────────

/**
 * Publish a photo or reel to Instagram.
 * 
 * Two-step process:
 * 1. Create a media container: POST /{ig-user-id}/media
 *    - Photo: { image_url, caption }
 *    - Reel:  { video_url, caption, media_type: 'REELS' }
 * 2. Poll container until ready
 * 3. Publish the container: POST /{ig-user-id}/media_publish
 * 
 * NOTE: Both image_url and video_url MUST be publicly accessible HTTPS URLs.
 */
export async function publishToInstagram(
    caption: string,
    mediaUrl: string,
    mediaType?: 'photo' | 'video'
): Promise<PublishResult> {
    const igUserId = getOptionalEnv('META_IG_USER_ID');
    const token = getOptionalEnv('META_PAGE_ACCESS_TOKEN');

    if (!igUserId || !token) {
        return {
            success: false,
            error: 'Instagram not configured. Set META_IG_USER_ID and META_PAGE_ACCESS_TOKEN.',
            platform: 'instagram',
        };
    }

    if (!mediaUrl || !mediaUrl.startsWith('http')) {
        return {
            success: false,
            error: 'Instagram requires media to be uploaded first. Use the upload button to select a file.',
            platform: 'instagram',
        };
    }

    const isVideo = mediaType === 'video' || isVideoUrl(mediaUrl);

    try {
        // Step 1: Create media container
        const containerBody: Record<string, string> = {
            caption: caption,
            access_token: token,
        };

        if (isVideo) {
            containerBody.video_url = mediaUrl;
            containerBody.media_type = 'REELS';
        } else {
            containerBody.image_url = mediaUrl;
        }

        const containerRes = await fetch(`${GRAPH_API_BASE}/${igUserId}/media`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(containerBody),
        });

        const containerData = await containerRes.json();

        if (containerData.error) {
            console.error('[Meta Publish IG] Container error:', containerData.error);
            let errorMsg = containerData.error.message || 'Failed to create Instagram media container';
            // Provide helpful context for common IG errors
            if (errorMsg.toLowerCase().includes('aspect ratio')) {
                errorMsg += ' Instagram requires images between 4:5 (portrait) and 1.91:1 (landscape). Try cropping the image before uploading.';
            }
            return {
                success: false,
                error: errorMsg,
                platform: 'instagram',
            };
        }

        const containerId = containerData.id;
        if (!containerId) {
            return {
                success: false,
                error: 'No container ID returned from Instagram',
                platform: 'instagram',
            };
        }

        // Step 2: Poll container status
        // Videos take longer to process than photos
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

        if (status === 'ERROR') {
            return {
                success: false,
                error: 'Instagram media processing failed. The file may be too large or in an unsupported format.',
                platform: 'instagram',
            };
        }

        if (status === 'IN_PROGRESS') {
            return {
                success: false,
                error: 'Instagram is still processing the media. Try again in a moment.',
                platform: 'instagram',
            };
        }

        // Step 3: Publish
        const publishRes = await fetch(`${GRAPH_API_BASE}/${igUserId}/media_publish`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                creation_id: containerId,
                access_token: token,
            }),
        });

        const publishData = await publishRes.json();

        if (publishData.error) {
            console.error('[Meta Publish IG] Publish error:', publishData.error);
            return {
                success: false,
                error: publishData.error.message || 'Failed to publish to Instagram',
                platform: 'instagram',
            };
        }

        console.log('[Meta Publish IG] Success:', publishData.id);
        return {
            success: true,
            postId: publishData.id,
            platform: 'instagram',
        };
    } catch (err: any) {
        console.error('[Meta Publish IG] Network error:', err);
        return {
            success: false,
            error: err.message || 'Network error publishing to Instagram',
            platform: 'instagram',
        };
    }
}

// ─── Multi-Platform Publish ─────────────────────────────────────────────────

/**
 * Publish to multiple platforms at once.
 * Returns individual results for each platform.
 */
export async function publishToMultiplePlatforms(
    platforms: string[],
    caption: string,
    mediaUrl?: string,
    mediaType?: 'photo' | 'video'
): Promise<PublishResult[]> {
    const results: PublishResult[] = [];

    const tasks = platforms.map(async (platform) => {
        if (platform === 'facebook') {
            return publishToFacebook(caption, mediaUrl, mediaType);
        } else if (platform === 'instagram') {
            if (!mediaUrl || !mediaUrl.startsWith('http')) {
                return {
                    success: false,
                    error: 'Instagram requires a photo or video. Upload a file first.',
                    platform: 'instagram' as const,
                };
            }
            return publishToInstagram(caption, mediaUrl, mediaType);
        } else if (platform === 'youtube') {
            return {
                success: false,
                error: 'YouTube publishing is not yet supported. Upload videos directly to YouTube Studio.',
                platform: 'youtube' as unknown as 'facebook',
            };
        }
        return {
            success: false,
            error: `Unknown platform: ${platform}`,
            platform: platform as 'facebook',
        };
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
