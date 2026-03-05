/**
 * /api/attribution/ghl-strategy
 * GET: Returns strategic analysis — insights, reactivation plans, recovery potential
 * Query params:
 *   - location: 'decatur' | 'smyrna' | 'kennesaw' (optional, default all)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isGHLConfigured, type LocationKey } from '@/lib/integrations/gohighlevel';
import { getStrategyAnalysis } from '@/lib/ghl-strategy';

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

    try {
        const data = await getStrategyAnalysis({
            locationFilter: locationParam || undefined,
            isAdmin,
        });

        return NextResponse.json({ configured: true, ...data });
    } catch (error: unknown) {
        console.error('[ghl-strategy] Error:', error);
        const message = error instanceof Error ? error.message : 'Failed to compute strategy';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
