import { NextResponse } from 'next/server';
import { getGoogleBusinessReviews, LocationId } from '@/lib/integrations/google-business';

// Unified review object for the frontend
export interface UnifiedReview {
    platform: 'google';
    id: string;
    reviewerName: string;
    rating: number;
    text: string;
    date: string; // ISO string
    url?: string;
    avatarUrl?: string;
}

export interface ReviewsResponse {
    locationId: LocationId | 'all';
    metrics: {
        totalReviews: number;
        averageRating: number;
        breakdown: {
            google: { count: number; rating: number };
        }
    };
    reviews: UnifiedReview[];
    isMock: boolean;
}

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const locParam = searchParams.get('location');

        let locationId: LocationId | undefined;
        if (locParam === 'atlanta' || locParam === 'decatur' || locParam === 'kennesaw') {
            locationId = locParam;
        }

        // Fetch Google Data
        const googleData = await getGoogleBusinessReviews(locationId);

        // Transform into unified schema
        const unifiedReviews: UnifiedReview[] = googleData.reviews.map(r => ({
            platform: 'google',
            id: r.reviewId,
            reviewerName: r.reviewer.displayName,
            rating: r.numericRating,
            text: r.comment,
            date: r.createTime,
            avatarUrl: r.reviewer.profilePhotoUrl
        }));

        // Sort chronologically (newest first)
        unifiedReviews.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        const response: ReviewsResponse = {
            locationId: locationId || 'all',
            metrics: {
                totalReviews: googleData.totalReviewCount,
                averageRating: googleData.averageRating,
                breakdown: {
                    google: { count: googleData.totalReviewCount, rating: googleData.averageRating },
                }
            },
            reviews: unifiedReviews,
            isMock: googleData.isMock,
        };

        return NextResponse.json(response);
    } catch (error) {
        console.error('Error fetching aggregated reviews:', error);
        return NextResponse.json({ error: 'Failed to fetch reviews' }, { status: 500 });
    }
}
