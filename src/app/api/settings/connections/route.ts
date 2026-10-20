import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isMetaConfigured } from '@/lib/integrations/meta-organic';
import { isYouTubeConfigured } from '@/lib/integrations/youtube';
import { isMetaAdsConfigured } from '@/lib/integrations/meta-ads';
import { isGoogleAdsConfigured } from '@/lib/integrations/google-ads';
import { isGscConfigured } from '@/lib/integrations/search-console';

/** Which integrations have their credentials set. Presence only; it doesn't call the APIs. */
export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const user = session.user as Record<string, unknown>;
    if (user.isAdmin !== true) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const platforms = [
        { name: 'Zenoti', connected: !!process.env.ZENOTI_API_KEY },
        { name: 'Instagram', connected: isMetaConfigured() },
        { name: 'Facebook', connected: isMetaConfigured() },
        { name: 'YouTube', connected: isYouTubeConfigured() },
        { name: 'Meta Ads', connected: isMetaAdsConfigured() },
        { name: 'Google Ads', connected: isGoogleAdsConfigured() },
        { name: 'Google Business', connected: !!process.env.GOOGLE_PLACES_API_KEY },
        { name: 'Search Console', connected: isGscConfigured() },
    ];
    return NextResponse.json({ platforms });
}
