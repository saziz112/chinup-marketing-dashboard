/**
 * /api/attribution/ghl-conversations
 * GET: Returns engagement intelligence — gaps, lost revenue, stale corrections
 * Query params:
 *   - location: 'decatur' | 'smyrna' | 'kennesaw' (optional, default all)
 *   - mode: 'summary' | 'full' (default summary)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { type LocationKey, isGHLConfigured } from '@/lib/integrations/gohighlevel';
import { getConversationsIntelligence } from '@/lib/integrations/ghl-conversations';

export async function GET(req: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user as Record<string, unknown>;
    const isAdmin = user.isAdmin === true;

    if (!isGHLConfigured()) {
        return NextResponse.json({ error: 'GoHighLevel not configured', configured: false }, { status: 503 });
    }

    const locationParam = req.nextUrl.searchParams.get('location') as LocationKey | null;
    const mode = req.nextUrl.searchParams.get('mode') || 'summary';
    const forceRefresh = req.nextUrl.searchParams.get('refresh') === 'true';

    try {
        const intelligence = await getConversationsIntelligence({
            locationFilter: locationParam || undefined,
            forceRefresh,
        });

        // Mask monetary values for non-admin users
        const maskValue = (v: number) => isAdmin ? v : 0;

        if (mode === 'summary') {
            return NextResponse.json({
                configured: true,
                isAdmin,
                summary: {
                    ...intelligence.summary,
                    lostRevenuePotential: maskValue(intelligence.summary.lostRevenuePotential),
                },
                lifecycleCounts: intelligence.lifecycleCounts,
                ghostAnalytics: intelligence.ghostAnalytics,
                speedToLead: {
                    avgMinutes: intelligence.speedToLead.avgMinutes,
                    neverResponded: intelligence.speedToLead.neverResponded,
                },
                engagementGapsCount: intelligence.engagementGaps.length,
                lostRevenueCandidatesCount: intelligence.lostRevenueCandidates.length,
                topEngagementGaps: intelligence.engagementGaps.slice(0, 10).map(g => ({
                    contactName: g.opportunity.contactName,
                    contactPhone: g.engagement.phone,
                    stageName: g.stageName,
                    monetaryValue: maskValue(g.monetaryValue),
                    daysSinceOutreach: g.daysSinceOutreach,
                    riskLevel: g.riskLevel,
                    suggestedAction: g.suggestedAction,
                    achievabilityScore: g.achievabilityScore,
                    callPriority: g.callPriority,
                    lifecycleStage: g.engagement.lifecycleStage,
                    locationName: g.locationName,
                    locationKey: g.locationKey,
                })),
                timestampFallbackCount: intelligence.timestampFallbackContacts.length,
                fetchedAt: intelligence.fetchedAt,
            });
        }

        // Full mode: everything
        if (!isAdmin) {
            // Mask values in full response for non-admin
            return NextResponse.json({
                configured: true,
                isAdmin,
                ...intelligence,
                engagementGaps: intelligence.engagementGaps.map(g => ({
                    ...g, monetaryValue: 0,
                    opportunity: { ...g.opportunity, monetaryValue: 0 },
                })),
                lostRevenueCandidates: intelligence.lostRevenueCandidates.map(c => ({
                    ...c, monetaryValue: 0,
                    opportunity: { ...c.opportunity, monetaryValue: 0 },
                })),
                timestampFallbackContacts: intelligence.timestampFallbackContacts.map(c => ({
                    ...c, opportunity: { ...c.opportunity, monetaryValue: 0 },
                })),
            });
        }

        return NextResponse.json({
            configured: true,
            isAdmin,
            ...intelligence,
        });
    } catch (error: unknown) {
        console.error('[ghl-conversations] Error:', error);
        const message = error instanceof Error ? error.message : 'Failed to fetch conversation intelligence';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
