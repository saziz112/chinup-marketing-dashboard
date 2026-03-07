/**
 * /api/attribution/ghl-transcript
 * GET: Fetches a call transcript on-demand (admin-only, PHI-protected)
 * Query params:
 *   - messageId: GHL message ID (required)
 *   - location: 'decatur' | 'smyrna' | 'kennesaw' (required)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { type LocationKey } from '@/lib/integrations/gohighlevel';
import { getCallTranscript } from '@/lib/integrations/ghl-conversations';

// v2 location config (same pattern as ghl-conversations.ts)
function getV2LocationConfig(locationKey: LocationKey): { locationId: string; pit: string } | null {
    const envMap: Record<LocationKey, { envId: string; envPit: string }> = {
        decatur: { envId: 'GHL_LOCATION_ID_DECATUR', envPit: 'GHL_PIT_DECATUR' },
        smyrna: { envId: 'GHL_LOCATION_ID_SMYRNA', envPit: 'GHL_PIT_SMYRNA' },
        kennesaw: { envId: 'GHL_LOCATION_ID_KENNESAW', envPit: 'GHL_PIT_KENNESAW' },
    };
    const config = envMap[locationKey];
    if (!config) return null;
    const locationId = process.env[config.envId];
    const pit = process.env[config.envPit];
    if (!locationId || !pit) return null;
    return { locationId, pit };
}

export async function GET(req: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Admin-only — transcripts contain PHI
    const user = session.user as Record<string, unknown>;
    if (user.isAdmin !== true) {
        return NextResponse.json({ error: 'Admin access required — transcripts may contain PHI' }, { status: 403 });
    }

    const messageId = req.nextUrl.searchParams.get('messageId');
    const locationKey = req.nextUrl.searchParams.get('location') as LocationKey | null;

    if (!messageId || !locationKey) {
        return NextResponse.json({ error: 'messageId and location are required' }, { status: 400 });
    }

    const locationConfig = getV2LocationConfig(locationKey);
    if (!locationConfig) {
        return NextResponse.json({ error: `Location ${locationKey} not configured` }, { status: 400 });
    }

    try {
        const transcript = await getCallTranscript(locationConfig.locationId, locationConfig.pit, messageId);

        return NextResponse.json({
            transcript,
            messageId,
            location: locationKey,
            phiWarning: 'This transcript may contain protected health information (PHI). Do not share or copy outside this dashboard.',
        });
    } catch (error: unknown) {
        console.error('[ghl-transcript] Error:', error);
        const message = error instanceof Error ? error.message : 'Failed to fetch transcript';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
