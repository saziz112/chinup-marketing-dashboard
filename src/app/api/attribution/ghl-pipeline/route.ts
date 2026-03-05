/**
 * /api/attribution/ghl-pipeline
 * GET: Returns full pipeline data across all GHL locations
 * Query params:
 *   - location: 'decatur' | 'smyrna' | 'kennesaw' (optional, default all)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getFullPipelineData, isGHLConfigured, type LocationKey } from '@/lib/integrations/gohighlevel';

export async function GET(req: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isGHLConfigured()) {
        return NextResponse.json({ error: 'GoHighLevel not configured', configured: false }, { status: 503 });
    }

    const user = session.user as Record<string, unknown>;
    const isAdmin = user.isAdmin === true;

    const locationParam = req.nextUrl.searchParams.get('location') as LocationKey | null;
    const forceRefresh = req.nextUrl.searchParams.get('refresh') === 'true';

    try {
        const data = await getFullPipelineData({
            locationFilter: locationParam || undefined,
            forceRefresh,
        });

        // Role-based filtering: non-admin sees counts but not dollar values
        if (!isAdmin) {
            const sanitized = {
                ...data,
                totals: {
                    ...data.totals,
                    totalValue: 0,
                    totalWonValue: 0,
                },
                locations: data.locations.map(loc => ({
                    ...loc,
                    pipelines: loc.pipelines.map(p => ({
                        ...p,
                        totalValue: 0,
                        wonValue: 0,
                        stages: p.stages.map(s => ({
                            ...s,
                            value: 0,
                            opportunities: s.opportunities.map(o => ({
                                ...o,
                                monetaryValue: 0,
                            })),
                        })),
                    })),
                })),
            };
            return NextResponse.json({ configured: true, ...sanitized });
        }

        return NextResponse.json({ configured: true, ...data });
    } catch (error: unknown) {
        console.error('[ghl-pipeline] Error:', error);
        const message = error instanceof Error ? error.message : 'Failed to fetch pipeline data';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
