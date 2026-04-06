/**
 * GET /api/paid-ads/creatives?since=...&until=...&platform=meta
 * Returns ad creative text (headlines, body copy) grouped by campaign.
 * Not financial data — available to any authenticated user.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getMetaAdCreatives, isMetaAdsConfigured } from '@/lib/integrations/meta-ads';
import { format, subDays } from 'date-fns';

export async function GET(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const since = request.nextUrl.searchParams.get('since') || format(subDays(new Date(), 29), 'yyyy-MM-dd');
        const until = request.nextUrl.searchParams.get('until') || format(new Date(), 'yyyy-MM-dd');
        const platform = request.nextUrl.searchParams.get('platform') || 'meta';

        if (platform === 'meta') {
            if (!isMetaAdsConfigured()) {
                return NextResponse.json({ creatives: {}, isConfigured: false });
            }

            const creativesMap = await getMetaAdCreatives(since, until);

            // Convert Map to plain object for JSON serialization
            const creatives: Record<string, Array<{ adId: string; title: string | null; body: string | null; linkDescription: string | null; thumbnailUrl: string | null }>> = {};
            for (const [campaignId, ads] of creativesMap) {
                creatives[campaignId] = ads;
            }

            return NextResponse.json({ creatives, isConfigured: true });
        }

        // Google creatives — future implementation
        return NextResponse.json({ creatives: {}, isConfigured: false, note: 'Google ad creatives not yet implemented' });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('/api/paid-ads/creatives error:', message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
