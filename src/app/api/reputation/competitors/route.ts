import { NextResponse } from 'next/server';
import { getIGCompetitorMetrics } from '@/lib/integrations/meta-organic';
import { getGoogleBusinessReviews, LocationId } from '@/lib/integrations/google-business';

// Dynamic insight mapper based on location
function getLocationInsights(locationId?: LocationId) {
    switch (locationId) {
        case 'atlanta':
            return {
                ourStrengths: ['Premium Injectables', 'Luxury Experience', 'Skilled NP Injectors'],
                ourWeaknesses: ['Parking Availability', 'Wait Times'],
                ourFeedback: [
                    'Highlight your premium experience—patients in Buckhead/Atlanta prioritize quality over price.',
                    'Consider offering valet or validated parking based on recent review friction.'
                ],
                comp1: { name: 'Aya Medical Spa', strengths: ['Brand Recognition', 'Multiple Locations'], weaknesses: ['Rushed Consultations', 'Impersonal Feel'] },
                comp2: { name: 'Peachtree Dermatology', strengths: ['Board Certified Dermatologists', 'Medical Expertise'], weaknesses: ['High Aesthetic Pricing', 'Clinical Atmosphere'] }
            };
        case 'decatur':
            return {
                ourStrengths: ['Community Focus', 'Friendly Staff', 'Effective Laser Treatments'],
                ourWeaknesses: ['Weekend Availability', 'Booking Lead Time'],
                ourFeedback: [
                    'Decatur clients heavily praise your staff. Feature them more in Instagram Stories.',
                    'Mention your cancellation list, as booking lead time is a common pain point.'
                ],
                comp1: { name: 'WIFH', strengths: ['Laser Hair Removal', 'Marketing Visibility'], weaknesses: ['Factory Feel', 'Inconsistent Results'] },
                comp2: { name: 'Slender Spa', strengths: ['Body Contouring focus', 'Affordable Pricing'], weaknesses: ['Outdated Facility', 'Pushy Sales Tactics'] }
            };
        case 'kennesaw':
            return {
                ourStrengths: ['Affordable Pricing', 'Acne Treatments', 'Student Discounts'],
                ourWeaknesses: ['Front Desk Communication', 'Phone Answering'],
                ourFeedback: [
                    'Your local competitors struggle with natural looking results—double down on your "undetectable injectables" messaging.',
                    'Improve phone answering rates to capture leads frustrated by competitor unresponsiveness.'
                ],
                comp1: { name: 'Colby Skin Clinic', strengths: ['Established Reputation', 'Loyal Patient Base'], weaknesses: ['Long Wait Times', 'Limited New Technologies'] },
                comp2: { name: 'Dermani Medspa', strengths: ['Membership Model', 'Convenient Hours'], weaknesses: ['High Turnover of Injectors', 'Inconsistent Customer Service'] }
            };
        default: // 'all' or undefined
            return {
                ourStrengths: ['Excellent Service', 'Professional Staff', 'Effective Treatments'],
                ourWeaknesses: ['Wait Times Can Vary', 'Limited Weekend Hours'],
                ourFeedback: [
                    'Highlight your transparent pricing to win over patients frustrated by competitor billing practices.',
                    'Emphasize your friendly front-desk staff to capitalize on competitor service complaints.'
                ],
                comp1: { name: 'Top Regional Competitor', strengths: ['Clinical Expertise', 'Clear Explanations'], weaknesses: ['Poor Billing Practices', 'No Refund Policy'] },
                comp2: { name: 'Value MedSpa Chain', strengths: ['Aggressive Pricing', 'Clean Environment'], weaknesses: ['Long Wait Times', 'Rude Front Desk'] }
            };
    }
}


export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const locParam = searchParams.get('location');

        let locationId: LocationId | undefined;
        if (locParam === 'atlanta' || locParam === 'decatur' || locParam === 'kennesaw') {
            locationId = locParam;
        }

        const insights = getLocationInsights(locationId);

        // 1. Fetch live IG competitor data (contains the competitor handles & followers)
        const igData = await getIGCompetitorMetrics(locationId);

        // 2. Fetch live Google data for Our Business
        const ourGoogleData = await getGoogleBusinessReviews(locationId);

        // 3. Construct "Our Business" profile
        const ourBusiness = {
            id: 'us',
            name: ourGoogleData.locationName,
            isOurBusiness: true,
            reputationScore: 81,
            scoreLabel: 'Good',
            averageRating: ourGoogleData.averageRating,
            reviewCount: ourGoogleData.totalReviewCount,
            avgResponseTimeDays: 12,
            avgResponseTimeHours: 16,
            responseRatePct: 98,
            strengths: insights.ourStrengths,
            weaknesses: insights.ourWeaknesses,
            feedback: insights.ourFeedback,
            instagramHandle: 'chinupaesthetics',
            followersCount: 22400, // Hardcoded for us since we only fetch competitor IG in that function
            mediaCount: 1540
        };

        // 4. Transform IG competitors into full Advanced Profiles
        const advancedCompetitors = igData.slice(0, 2).map((comp, idx) => {
            const isFirst = idx === 0;
            const compInsight = isFirst ? insights.comp1 : insights.comp2;
            return {
                id: comp.username,
                name: compInsight.name,
                isOurBusiness: false,
                reputationScore: isFirst ? 35 : 52,
                scoreLabel: isFirst ? 'Needs Work' : 'Fair',
                averageRating: isFirst ? 4.78 : 4.92,
                reviewCount: isFirst ? 119 : 126,
                avgResponseTimeDays: isFirst ? 5 : 36,
                avgResponseTimeHours: isFirst ? 5 : 19,
                responseRatePct: isFirst ? 14 : 56,
                strengths: compInsight.strengths,
                weaknesses: compInsight.weaknesses,
                instagramHandle: comp.username,
                followersCount: comp.followersCount,
                mediaCount: comp.mediaCount
            };
        });

        return NextResponse.json({
            locationId: locationId || 'all',
            competitors: [ourBusiness, ...advancedCompetitors]
        });
    } catch (error) {
        console.error('Error fetching Competitor data:', error);
        return NextResponse.json({ error: 'Failed to fetch competitor data' }, { status: 500 });
    }
}
