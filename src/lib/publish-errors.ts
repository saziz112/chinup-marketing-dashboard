// Publish error categorization — pure TS, no server-only deps.
// Safe to import from client components (see PublishHelpers.tsx).

export type FailureBucket =
    | 'transient_meta'
    | 'token_expired'
    | 'media_invalid'
    | 'ratio_invalid'
    | 'config_missing'
    | 'rate_limited'
    | 'unknown';

export interface FailureInfo {
    bucket: FailureBucket;
    label: string;
    suggestion: string;
    retryable: boolean;
}

/** Map a raw platform error message to a human-friendly failure bucket. */
export function categorizeError(raw: string): FailureInfo {
    const msg = (raw || '').toLowerCase();

    if (msg.includes('unexpected error has occurred') || msg.includes('please retry')) {
        return {
            bucket: 'transient_meta',
            label: 'Meta hiccup',
            suggestion: 'Temporary Meta server error. Retry — usually succeeds on the second attempt.',
            retryable: true,
        };
    }
    if (msg.includes('access token') || msg.includes('session has been invalidated') || msg.includes('expired')) {
        return {
            bucket: 'token_expired',
            label: 'API token expired',
            suggestion: 'Regenerate META_PAGE_ACCESS_TOKEN in Vercel env vars. Retry will not help until token is refreshed.',
            retryable: false,
        };
    }
    if (msg.includes('aspect ratio')) {
        return {
            bucket: 'ratio_invalid',
            label: 'Aspect ratio rejected',
            suggestion: 'Instagram requires 4:5 to 1.91:1. Re-crop the image manually and re-upload.',
            retryable: false,
        };
    }
    if (msg.includes('not configured') || msg.includes('invalid accountid') || msg.includes('invalid parameter')) {
        return {
            bucket: 'config_missing',
            label: 'Platform not configured',
            suggestion: 'API credentials or account IDs missing/invalid. Check env vars for this platform.',
            retryable: false,
        };
    }
    if (msg.includes('image preparation failed')) {
        return {
            bucket: 'media_invalid',
            label: 'Image processing failed',
            suggestion: 'Sharp or Blob upload failed on our side — check Vercel function logs for the exact stage. Often BLOB_READ_WRITE_TOKEN expired or Blob quota hit.',
            retryable: true,
        };
    }
    if (msg.includes('only photo or video') || msg.includes('media type') || msg.includes('media processing failed')) {
        return {
            bucket: 'media_invalid',
            label: 'Media rejected',
            suggestion: 'Media URL expired or file type not supported. Re-upload the image/video.',
            retryable: false,
        };
    }
    if (msg.includes('rate limit') || msg.includes('too many requests')) {
        return {
            bucket: 'rate_limited',
            label: 'Rate limited',
            suggestion: 'Too many API calls. Wait a few minutes and retry.',
            retryable: true,
        };
    }
    return {
        bucket: 'unknown',
        label: 'Unknown error',
        suggestion: 'Unclassified error. See raw message below.',
        retryable: true,
    };
}
