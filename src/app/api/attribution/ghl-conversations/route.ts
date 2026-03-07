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

    // Admin-only for Phase 27
    const user = session.user as Record<string, unknown>;
    const isAdmin = user.isAdmin === true;
    if (!isAdmin) {
        return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

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

        if (mode === 'summary') {
            // Summary mode: just KPIs, counts, top gaps — no full engagement objects
            return NextResponse.json({
                configured: true,
                summary: intelligence.summary,
                lifecycleCounts: intelligence.lifecycleCounts,
                speedToLead: {
                    avgMinutes: intelligence.speedToLead.avgMinutes,
                    neverResponded: intelligence.speedToLead.neverResponded,
                },
                engagementGapsCount: intelligence.engagementGaps.length,
                lostRevenueCandidatesCount: intelligence.lostRevenueCandidates.length,
                topEngagementGaps: intelligence.engagementGaps.slice(0, 10).map(g => ({
                    contactName: g.opportunity.contactName,
                    stageName: g.stageName,
                    monetaryValue: g.monetaryValue,
                    daysSinceOutreach: g.daysSinceOutreach,
                    riskLevel: g.riskLevel,
                    suggestedAction: g.suggestedAction,
                    achievabilityScore: g.achievabilityScore,
                    locationName: g.locationName,
                })),
                fetchedAt: intelligence.fetchedAt,
            });
        }

        // Full mode: everything (admin sees all values)
        return NextResponse.json({
            configured: true,
            ...intelligence,
        });
    } catch (error: unknown) {
        console.error('[ghl-conversations] Error:', error);
        const message = error instanceof Error ? error.message : 'Failed to fetch conversation intelligence';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
