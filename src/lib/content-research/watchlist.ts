/**
 * Watchlist account parsing and dedupe. Accepts whatever someone pastes
 * (a handle, @handle, or profile URL) and turns it into one canonical key.
 */

export type Platform = 'instagram' | 'tiktok' | 'youtube';
export const PLATFORMS: Platform[] = ['instagram', 'tiktok', 'youtube'];

export type AccountCategory = 'injector_creator' | 'medspa_brand' | 'atlanta_competitor' | 'other';

export interface AccountInput {
    platform: Platform;
    handle: string;
    displayName?: string;
    category?: AccountCategory;
}

const HANDLE_RE = /^[A-Za-z0-9._-]{1,64}$/;
const YT_CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{6,}$/;

function platformFromUrl(url: URL): Platform | null {
    const host = url.hostname.replace(/^www\.|^m\./, '');
    if (host === 'instagram.com') return 'instagram';
    if (host === 'tiktok.com') return 'tiktok';
    if (host === 'youtube.com' || host === 'youtu.be') return 'youtube';
    return null;
}

/** Returns null when the input isn't a usable account handle or profile URL. */
export function parseAccountInput(platform: Platform, raw: string): { platform: Platform; handle: string } | null {
    const input = raw.trim();
    if (!input) return null;

    let handle = input;
    let resolvedPlatform = platform;

    if (/^https?:\/\//i.test(input) || /^(www\.)?(instagram|tiktok|youtube)\.com\//i.test(input)) {
        let url: URL;
        try {
            url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
        } catch {
            return null;
        }
        const fromUrl = platformFromUrl(url);
        if (!fromUrl) return null;
        resolvedPlatform = fromUrl;
        const parts = url.pathname.split('/').filter(Boolean);
        if (fromUrl === 'youtube') {
            if (parts[0]?.startsWith('@')) handle = parts[0];
            else if (parts[0] === 'channel' && parts[1]) handle = parts[1];
            else return null;
        } else if (fromUrl === 'tiktok') {
            if (!parts[0]?.startsWith('@')) return null;
            handle = parts[0];
        } else {
            // instagram.com/<handle>; reject /p/, /reel/, /explore/ etc.
            if (parts.length !== 1 || ['p', 'reel', 'reels', 'explore', 'stories', 'tv'].includes(parts[0])) return null;
            handle = parts[0];
        }
    }

    handle = handle.replace(/^@/, '');
    if (!HANDLE_RE.test(handle)) return null;
    if (!(resolvedPlatform === 'youtube' && YT_CHANNEL_ID_RE.test(handle))) handle = handle.toLowerCase();
    return { platform: resolvedPlatform, handle };
}

/** YouTube channel ids are case-sensitive; every other handle is not. */
export function accountKey(platform: Platform, handle: string): string {
    const h = handle.replace(/^@/, '');
    return `${platform}:${platform === 'youtube' && YT_CHANNEL_ID_RE.test(h) ? h : h.toLowerCase()}`;
}

export function dedupeAccounts<T extends AccountInput>(accounts: T[]): T[] {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const a of accounts) {
        const parsed = parseAccountInput(a.platform, a.handle);
        if (!parsed) continue;
        const key = accountKey(parsed.platform, parsed.handle);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ ...a, platform: parsed.platform, handle: parsed.handle });
    }
    return out;
}
