import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const place = (rating: number, count: number) => ({ rating, userRatingCount: count, reviews: [{ name: `r${count}`, rating: 5, text: { text: 'great' }, publishTime: '2026-10-01T00:00:00Z' }] });

function stubPlaces(statusFor: (id: string) => number) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        const id = url.split('/places/')[1].split('?')[0];
        const status = statusFor(id);
        const body = id === 'P_ATL' ? place(5, 138) : id === 'P_DEC' ? place(4.9, 227) : place(4.9, 448);
        return { ok: status < 400, status, statusText: 'err', json: async () => body } as Response;
    }));
}

async function load() {
    vi.resetModules();
    return import('./google-business');
}

describe('getGoogleBusinessReviews', () => {
    beforeEach(() => {
        vi.stubEnv('GOOGLE_PLACES_API_KEY', 'k');
        vi.stubEnv('GOOGLE_PLACE_ID_ATLANTA', 'P_ATL');
        vi.stubEnv('GOOGLE_PLACE_ID_DECATUR', 'P_DEC');
        vi.stubEnv('GOOGLE_PLACE_ID_KENNESAW', 'P_KEN');
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

    it('sums live counts across all three places', async () => {
        stubPlaces(() => 200);
        const { getGoogleBusinessReviews } = await load();
        const d = await getGoogleBusinessReviews();
        expect(d.totalReviewCount).toBe(813);
        expect(d.isMock).toBe(false);
    });

    it('throws when the API key is missing instead of returning mock reviews', async () => {
        vi.stubEnv('GOOGLE_PLACES_API_KEY', '');
        stubPlaces(() => 200);
        const { getGoogleBusinessReviews } = await load();
        await expect(getGoogleBusinessReviews()).rejects.toThrow();
    });

    it('throws when every place fails, and does not cache the failure', async () => {
        let status = 403;
        stubPlaces(() => status);
        const { getGoogleBusinessReviews } = await load();
        await expect(getGoogleBusinessReviews()).rejects.toThrow();
        status = 200;
        expect((await getGoogleBusinessReviews()).totalReviewCount).toBe(813);
    });

    it('throws when one place fails rather than dropping it from the All total', async () => {
        stubPlaces(id => (id === 'P_DEC' ? 500 : 200));
        const { getGoogleBusinessReviews } = await load();
        await expect(getGoogleBusinessReviews()).rejects.toThrow();
    });
});
