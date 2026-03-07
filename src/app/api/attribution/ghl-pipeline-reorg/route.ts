/**
 * /api/attribution/ghl-pipeline-reorg
 * GET: Returns stage move recommendations (read-only preview)
 * POST: Applies selected moves via GHL v2 PUT /opportunities/{id}
 * Admin-only — stage moves affect pipeline data and may trigger GHL automations
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { type LocationKey, isGHLConfigured } from '@/lib/integrations/gohighlevel';
import { computeStageRecommendations } from '@/lib/integrations/ghl-conversations';
import { trackCall } from '@/lib/api-usage-tracker';

const GHL_V2_BASE = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = '2021-07-28';

function getV2PIT(locationKey: LocationKey): string | null {
    const envMap: Record<LocationKey, string> = {
        decatur: 'GHL_PIT_DECATUR',
        smyrna: 'GHL_PIT_SMYRNA',
        kennesaw: 'GHL_PIT_KENNESAW',
    };
    return process.env[envMap[locationKey]] || null;
}

export async function GET(req: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user as Record<string, unknown>;
    if (user.isAdmin !== true) {
        return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    if (!isGHLConfigured()) {
        return NextResponse.json({ error: 'GoHighLevel not configured' }, { status: 503 });
    }

    const locationParam = req.nextUrl.searchParams.get('location') as LocationKey | null;

    try {
        const recommendations = await computeStageRecommendations(locationParam || undefined);
        return NextResponse.json({
            recommendations,
            total: recommendations.length,
            warning: 'Moving leads between stages may trigger GHL automations (emails, texts, workflows). Review each move before applying.',
        });
    } catch (error: unknown) {
        console.error('[ghl-pipeline-reorg] Error:', error);
        const message = error instanceof Error ? error.message : 'Failed to compute recommendations';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user as Record<string, unknown>;
    if (user.isAdmin !== true) {
        return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    try {
        const body = await req.json();
        const moves: { opportunityId: string; newStageId: string; pipelineId: string; locationKey: LocationKey }[] = body.moves || [];

        if (moves.length === 0) {
            return NextResponse.json({ error: 'No moves provided' }, { status: 400 });
        }
        if (moves.length > 50) {
            return NextResponse.json({ error: 'Maximum 50 moves per request' }, { status: 400 });
        }

        const results: { opportunityId: string; success: boolean; error?: string }[] = [];

        for (const move of moves) {
            const pit = getV2PIT(move.locationKey);
            if (!pit) {
                results.push({ opportunityId: move.opportunityId, success: false, error: `No PIT for ${move.locationKey}` });
                continue;
            }

            try {
                const res = await fetch(`${GHL_V2_BASE}/opportunities/${move.opportunityId}`, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${pit}`,
                        'Version': GHL_API_VERSION,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                    },
                    body: JSON.stringify({
                        pipelineStageId: move.newStageId,
                        pipelineId: move.pipelineId,
                    }),
                });
                trackCall('ghl', 'updateOpportunityStage', false);

                if (res.ok) {
                    results.push({ opportunityId: move.opportunityId, success: true });
                } else {
                    const text = await res.text();
                    results.push({ opportunityId: move.opportunityId, success: false, error: `${res.status}: ${text.slice(0, 100)}` });
                }
            } catch (err: unknown) {
                results.push({ opportunityId: move.opportunityId, success: false, error: err instanceof Error ? err.message : 'Unknown error' });
            }

            // 100ms delay between calls to be gentle on rate limits
            await new Promise(r => setTimeout(r, 100));
        }

        const succeeded = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;

        return NextResponse.json({
            results,
            summary: { total: moves.length, succeeded, failed },
            message: failed === 0
                ? `Successfully moved ${succeeded} opportunities`
                : `${succeeded} succeeded, ${failed} failed`,
        });
    } catch (error: unknown) {
        console.error('[ghl-pipeline-reorg] POST Error:', error);
        const message = error instanceof Error ? error.message : 'Failed to apply moves';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
