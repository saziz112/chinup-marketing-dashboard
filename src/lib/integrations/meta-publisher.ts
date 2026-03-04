/**
 * Meta Publishing API Client
 * 
 * Handles live publishing to Facebook Pages and Instagram Business accounts
 * using the Meta Graph API v21.0.
 * 
 * Facebook: POST /{page-id}/feed (text) or /{page-id}/photos (image)
 * Instagram: POST /{ig-user-id}/media → /{ig-user-id}/media_publish
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

// ─── Facebook Page Publishing ───────────────────────────────────────────────

export interface PublishResult {
    success: boolean;
    postId?: string;
    error?: string;
    platform: 'facebook' | 'instagram';
}

/**
 * Publish a post to the Facebook Page.
 * 
 * - Text-only: POST /{page-id}/feed with message
 * - Image + text: POST /{page-id}/photos with url + message
 */
export async function publishToFacebook(
    caption: string,
    imageUrl?: string
): Promise<PublishResult> {
    const pageId = getEnv('META_PAGE_ID');
    const token = getEnv('META_PAGE_ACCESS_TOKEN');

    try {
        let endpoint: string;
        let body: Record<string, string>;

        if (imageUrl && imageUrl.startsWith('http')) {
            // Image post
            endpoint = `${GRAPH_API_BASE}/${pageId}/photos`;
            body = {
                url: imageUrl,
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
 * Publish an image post to Instagram.
 * 
 * Two-step process:
 * 1. Create a media container: POST /{ig-user-id}/media
 * 2. Publish the container: POST /{ig-user-id}/media_publish
 * 
 * NOTE: Instagram requires a publicly accessible image URL.
 * Local file paths and data URIs will NOT work.
 * Instagram also requires Business/Creator account connected via Facebook Page.
 */
export async function publishToInstagram(
    caption: string,
    imageUrl: string
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

    if (!imageUrl || !imageUrl.startsWith('http')) {
        return {
            success: false,
            error: 'Instagram requires a publicly accessible image URL (https://...). Local files are not supported.',
            platform: 'instagram',
        };
    }

    try {
        // Step 1: Create media container
        const containerRes = await fetch(`${GRAPH_API_BASE}/${igUserId}/media`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                image_url: imageUrl,
                caption: caption,
                access_token: token,
            }),
        });

        const containerData = await containerRes.json();

        if (containerData.error) {
            console.error('[Meta Publish IG] Container error:', containerData.error);
            return {
                success: false,
                error: containerData.error.message || 'Failed to create Instagram media container',
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

        // Step 2: Poll container status (Instagram needs a moment to process the image)
        let status = 'IN_PROGRESS';
        let attempts = 0;
        while (status === 'IN_PROGRESS' && attempts < 10) {
            await new Promise(resolve => setTimeout(resolve, 2000)); // wait 2s
            const statusRes = await fetch(
                `${GRAPH_API_BASE}/${containerId}?fields=status_code&access_token=${token}`
            );
            const statusData = await statusRes.json();
            status = statusData.status_code || 'FINISHED';
            attempts++;
        }

        if (status === 'ERROR') {
            return {
                success: false,
                error: 'Instagram media processing failed',
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
    imageUrl?: string
): Promise<PublishResult[]> {
    const results: PublishResult[] = [];

    const tasks = platforms.map(async (platform) => {
        if (platform === 'facebook') {
            return publishToFacebook(caption, imageUrl);
        } else if (platform === 'instagram') {
            if (!imageUrl || !imageUrl.startsWith('http')) {
                return {
                    success: false,
                    error: 'Instagram requires a public image URL',
                    platform: 'instagram' as const,
                };
            }
            return publishToInstagram(caption, imageUrl);
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
