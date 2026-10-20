import { describe, it, expect } from 'vitest';
import { parseAccountInput, dedupeAccounts, accountKey } from './watchlist';

describe('parseAccountInput', () => {
    it('strips @ and lowercases a bare handle', () => {
        expect(parseAccountInput('instagram', '@Dr.Smith_Injects')).toEqual({ platform: 'instagram', handle: 'dr.smith_injects' });
    });

    it('pulls the handle out of an Instagram profile URL', () => {
        expect(parseAccountInput('instagram', 'https://www.instagram.com/skinsocialspa/?hl=en')).toEqual({ platform: 'instagram', handle: 'skinsocialspa' });
    });

    it('pulls the handle out of a TikTok URL and detects the platform from it', () => {
        expect(parseAccountInput('instagram', 'https://www.tiktok.com/@someinjector?lang=en')).toEqual({ platform: 'tiktok', handle: 'someinjector' });
    });

    it('keeps a YouTube @handle and a channel id', () => {
        expect(parseAccountInput('youtube', 'https://www.youtube.com/@DrDrayzday/shorts')).toEqual({ platform: 'youtube', handle: 'drdrayzday' });
        expect(parseAccountInput('youtube', 'https://youtube.com/channel/UCabcDEF123')).toEqual({ platform: 'youtube', handle: 'UCabcDEF123' });
    });

    it('rejects empty input, spaces, and post URLs', () => {
        expect(parseAccountInput('instagram', '   ')).toBeNull();
        expect(parseAccountInput('instagram', 'two words')).toBeNull();
        expect(parseAccountInput('instagram', 'https://www.instagram.com/reel/C8xyz/')).toBeNull();
    });
});

describe('dedupeAccounts', () => {
    it('treats the same handle on the same platform as one account, keeping the first', () => {
        const out = dedupeAccounts([
            { platform: 'instagram', handle: 'skinsocialspa', displayName: 'Skin Social' },
            { platform: 'instagram', handle: '@SkinSocialSpa', displayName: 'dupe' },
            { platform: 'tiktok', handle: 'skinsocialspa', displayName: 'Skin Social TT' },
        ]);
        expect(out).toHaveLength(2);
        expect(out[0].displayName).toBe('Skin Social');
        expect(out.map(a => a.platform)).toEqual(['instagram', 'tiktok']);
    });

    it('drops entries whose handle cannot be parsed', () => {
        expect(dedupeAccounts([{ platform: 'instagram', handle: '' }])).toEqual([]);
    });
});

describe('accountKey', () => {
    it('is case-insensitive for IG/TikTok but not for YouTube channel ids', () => {
        expect(accountKey('instagram', 'ABC')).toBe(accountKey('instagram', 'abc'));
        expect(accountKey('youtube', 'UCabcDEF123')).not.toBe(accountKey('youtube', 'UCABCdef123'));
    });
});
