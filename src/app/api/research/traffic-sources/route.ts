/**
 * GET /api/research/traffic-sources?days=30
 * Returns website traffic source data from GA4.
 * Shows Instagram → website → which pages, plus overall source breakdown.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getTrafficSources } from '@/lib/integrations/google-analytics';

export async function GET(req: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const days = Math.min(90, Math.max(7, Number(req.nextUrl.searchParams.get('days')) || 30));

    try {
        const data = await getTrafficSources(days);
        return NextResponse.json(data);
    } catch (error: any) {
        console.error('[research/traffic-sources] Error:', error);
        return NextResponse.json({ error: error.message || 'Traffic source fetch failed' }, { status: 500 });
    }
}
