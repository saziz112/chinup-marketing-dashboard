import { subDays, subMonths } from 'date-fns';

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

// Allowed location IDs for mock data
export type LocationId = 'atlanta' | 'decatur' | 'kennesaw';

// In-memory cache
const cachedData = new Map<string, GoogleBusinessData>();
let lastFetchTime: number = 0;
const CACHE_DURATION_MS = 4 * 60 * 60 * 1000; // 4 hours

/**
 * Generates realistic mock Google Reviews for a Med Spa.
 */
function getMockGoogleReviews(locationId?: LocationId): GoogleBusinessData {
    const today = new Date();

    // Core pool of reviews
    const allReviews: (GoogleReview & { location: LocationId })[] = [
        {
            name: 'locations/123/reviews/r1',
            reviewId: 'r1',
            reviewer: { displayName: 'Sarah Jenkins', isAnonymous: false },
            starRating: 'FIVE',
            numericRating: 5,
            comment: 'Absolutely love Chin Up! Aesthetics Atlanta. The staff is so welcoming and my Botox results are flawless. Sam is amazing.',
            createTime: subDays(today, 2).toISOString(),
            updateTime: subDays(today, 2).toISOString(),
            reviewReply: {
                comment: 'Thank you so much Sarah! We love having you and are thrilled you love your results.',
                updateTime: subDays(today, 1).toISOString(),
            },
            location: 'atlanta'
        },
        {
            name: 'locations/123/reviews/r2',
            reviewId: 'r2',
            reviewer: { displayName: 'Michelle T.', isAnonymous: false },
            starRating: 'FIVE',
            numericRating: 5,
            comment: 'First time getting lip flips at the Decatur location and they made me feel completely at ease. Very professional environment. Highly recommend.',
            createTime: subDays(today, 5).toISOString(),
            updateTime: subDays(today, 5).toISOString(),
            location: 'decatur'
        },
        {
            name: 'locations/123/reviews/r3',
            reviewId: 'r3',
            reviewer: { displayName: 'Lauren B.', isAnonymous: false },
            starRating: 'FOUR',
            numericRating: 4,
            comment: 'Great service and clean facility at Kennesaw. The wait time was a little longer than expected, but the HydraFacial was totally worth it.',
            createTime: subDays(today, 12).toISOString(),
            updateTime: subDays(today, 12).toISOString(),
            location: 'kennesaw'
        },
        {
            name: 'locations/123/reviews/r4',
            reviewId: 'r4',
            reviewer: { displayName: 'Jessica R.', isAnonymous: false },
            starRating: 'FIVE',
            numericRating: 5,
            comment: 'I’ve been coming here for a year for laser hair removal and the results are incredible. The team always makes sure I’m comfortable.',
            createTime: subMonths(today, 1).toISOString(),
            updateTime: subMonths(today, 1).toISOString(),
            location: 'atlanta'
        },
        {
            name: 'locations/123/reviews/r5',
            reviewId: 'r5',
            reviewer: { displayName: 'A Google User', isAnonymous: true },
            starRating: 'THREE',
            numericRating: 3,
            comment: 'Service was okay, but I felt a bit rushed during my consultation in Decatur.',
            createTime: subMonths(today, 2).toISOString(),
            updateTime: subMonths(today, 2).toISOString(),
            location: 'decatur'
        },
        {
            name: 'locations/123/reviews/r6',
            reviewId: 'r6',
            reviewer: { displayName: 'Amanda C.', isAnonymous: false },
            starRating: 'FIVE',
            numericRating: 5,
            comment: 'Best injector in Georgia! I drive an hour just to come to the Kennesaw clinic!',
            createTime: subDays(today, 20).toISOString(),
            updateTime: subDays(today, 20).toISOString(),
            location: 'kennesaw'
        }
    ];

    let filteredReviews = allReviews;
    let locationName = 'Chin Up! Aesthetics (All Locations)';
    let totalCount = 142;
    let avg = 4.8;

    if (locationId) {
        filteredReviews = allReviews.filter(r => r.location === locationId);
        if (locationId === 'atlanta') { locationName += ' - Atlanta'; totalCount = 68; avg = 4.9; }
        if (locationId === 'decatur') { locationName += ' - Decatur'; totalCount = 42; avg = 4.6; }
        if (locationId === 'kennesaw') { locationName += ' - Kennesaw'; totalCount = 32; avg = 4.8; }
    }

    return {
        locationName,
        totalReviewCount: totalCount,
        averageRating: avg,
        reviews: filteredReviews.map(({ location, ...rest }) => rest), // remove internal location flag
        isMock: true,
    };
}

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

    if (!apiKey) {
        console.warn('[Google Places] Missing GOOGLE_PLACES_API_KEY. Falling back to mock Google reviews.');
        const mock = getMockGoogleReviews(locationId);
        cachedData.set(cacheKey, mock);
        lastFetchTime = now;
        return mock;
    }

    const targetLocations = locationId
        ? [locationId]
        : ['atlanta', 'decatur', 'kennesaw'] as LocationId[];

    const results: GoogleReview[] = [];
    let totalReviewersCount = 0;
    let weightedRatingSum = 0;

    console.log(`[Google Places] Fetching live reviews for ${targetLocations.length} location(s)...`);

    for (const loc of targetLocations) {
        const placeId = process.env[`GOOGLE_PLACE_ID_${loc.toUpperCase()}`];
        if (!placeId) {
            console.warn(`[Google Places] Missing place ID for location ${loc} (GOOGLE_PLACE_ID_${loc.toUpperCase()}). Skipping.`);
            continue;
        }

        try {
            const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}?fields=id,displayName,rating,userRatingCount,reviews`, {
                headers: {
                    'X-Goog-Api-Key': apiKey
                }
            });

            if (!res.ok) {
                console.error(`[Google Places] Failed to fetch place ${placeId}: ${res.statusText}`);
                continue;
            }

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
        } catch (e: any) {
            console.error(`[Google Places] Error fetching live reviews for ${loc}: ${e.message}`);
        }
    }

    // If all live fetches failed for some reason, fallback to mock to prevent crashing the dashboard
    if (results.length === 0 && totalReviewersCount === 0) {
        console.warn('[Google Places] Live fetch yielded 0 results. Falling back to mock Google reviews.');
        const mock = getMockGoogleReviews(locationId);
        cachedData.set(cacheKey, mock);
        lastFetchTime = now;
        return mock;
    }

    const averageRating = totalReviewersCount > 0
        ? Number((weightedRatingSum / totalReviewersCount).toFixed(1))
        : 5.0;

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
