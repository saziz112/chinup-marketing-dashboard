
export interface GoogleReview {
    name: string;
    reviewId: string;
    reviewer: {
        profilePhotoUrl?: string;
        displayName: string;
        isAnonymous: boolean;
    };
    starRating: 'ONE' | 'TWO' | 'THREE' | 'FOUR' | 'FIVE';
    numericRating: number;
    comment: string;
    createTime: string;
    updateTime: string;
    reviewReply?: {
        comment: string;
        updateTime: string;
    };
}

export interface GoogleBusinessData {
    locationName: string;
    totalReviewCount: number;
    averageRating: number;
    reviews: GoogleReview[];
    isMock: boolean;
}

export type LocationId = 'atlanta' | 'decatur' | 'kennesaw';

// In-memory cache
const cachedData = new Map<string, GoogleBusinessData>();
let lastFetchTime: number = 0;
const CACHE_DURATION_MS = 4 * 60 * 60 * 1000; // 4 hours

/**
 * Map Google Places API numeric rating to our internal enum
 */
function mapRating(rating: number): GoogleReview['starRating'] {
    if (rating >= 4.5) return 'FIVE';
    if (rating >= 3.5) return 'FOUR';
    if (rating >= 2.5) return 'THREE';
    if (rating >= 1.5) return 'TWO';
    return 'ONE';
}

/**
 * Fetches Google Business Profile reviews using the Google Places API (New).
 */
export async function getGoogleBusinessReviews(locationId?: LocationId): Promise<GoogleBusinessData> {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    const now = Date.now();
    const cacheKey = `google_reviews_${locationId || 'all'}`;
    const cached = cachedData.get(cacheKey);

    // Return cached data if valid
    if (cached && (now - lastFetchTime) < CACHE_DURATION_MS) {
        return cached;
    }

    if (!apiKey) throw new Error('Google reviews not configured: GOOGLE_PLACES_API_KEY is missing');

    const targetLocations = locationId
        ? [locationId]
        : ['atlanta', 'decatur', 'kennesaw'] as LocationId[];

    const results: GoogleReview[] = [];
    let totalReviewersCount = 0;
    let weightedRatingSum = 0;

    console.log(`[Google Places] Fetching live reviews for ${targetLocations.length} location(s)...`);

    // Any failed location fails the call: a partial "All" total would read as real.
    for (const loc of targetLocations) {
        const placeId = process.env[`GOOGLE_PLACE_ID_${loc.toUpperCase()}`];
        if (!placeId) throw new Error(`Google reviews not configured: GOOGLE_PLACE_ID_${loc.toUpperCase()} is missing`);

        {
            const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}?fields=id,displayName,rating,userRatingCount,reviews`, {
                headers: {
                    'X-Goog-Api-Key': apiKey
                }
            });

            if (!res.ok) throw new Error(`Google Places error for ${loc}: ${res.status} ${res.statusText}`);

            const data = await res.json();

            if (data.rating && data.userRatingCount) {
                totalReviewersCount += data.userRatingCount;
                weightedRatingSum += (data.rating * data.userRatingCount);
            }

            if (data.reviews && Array.isArray(data.reviews)) {
                // The Places API returns up to 5 reviews
                for (const r of data.reviews) {
                    const mapped: GoogleReview = {
                        name: r.name || `locations/${loc}/reviews/${Math.random().toString(36).substring(7)}`,
                        reviewId: r.name || Math.random().toString(36).substring(7), // Fallback if r.name is missing
                        reviewer: {
                            displayName: r.authorAttribution?.displayName || 'Google User',
                            profilePhotoUrl: r.authorAttribution?.photoUri,
                            isAnonymous: !r.authorAttribution?.displayName, // Keep isAnonymous as per interface
                        },
                        numericRating: r.rating || 5, // Fallback to 5 if missing?
                        starRating: mapRating(r.rating || 5),
                        comment: r.text?.text || '',
                        createTime: r.publishTime || new Date().toISOString(),
                        updateTime: r.publishTime || new Date().toISOString(),
                    };
                    results.push(mapped);
                }
            }
        }
    }

    const averageRating = totalReviewersCount > 0
        ? Number((weightedRatingSum / totalReviewersCount).toFixed(1))
        : 0;

    let locationName = 'Chin Up! Aesthetics (All Locations)';
    if (locationId === 'atlanta') locationName = 'Chin Up! Aesthetics - Atlanta';
    if (locationId === 'decatur') locationName = 'Chin Up! Aesthetics - Decatur';
    if (locationId === 'kennesaw') locationName = 'Chin Up! Aesthetics - Kennesaw';

    // Sort all reviews by date descending before returning
    results.sort((a, b) => new Date(b.createTime).getTime() - new Date(a.createTime).getTime());

    const output: GoogleBusinessData = {
        locationName,
        totalReviewCount: totalReviewersCount,
        averageRating,
        reviews: results,
        isMock: false
    };

    cachedData.set(cacheKey, output);
    lastFetchTime = now;
    return output;
}
