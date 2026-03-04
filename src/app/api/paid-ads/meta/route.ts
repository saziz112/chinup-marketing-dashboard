import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getMetaAdsData, isMetaAdsConfigured } from '@/lib/integrations/meta-ads';
import { subDays, format, startOfMonth } from 'date-fns';

const today = new Date();
const defaultUntil = format(today, 'yyyy-MM-dd');
const defaultSince = format(subDays(today, 29), 'yyyy-MM-dd');

export async function GET(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const user = session.user as Record<string, unknown>;
        const isAdmin = user.isAdmin === true;

        // --- Date range ---
        const since = request.nextUrl.searchParams.get('since') || defaultSince;
        const until = request.nextUrl.searchParams.get('until') || defaultUntil;

        // --- Fetch ---
        const data = await getMetaAdsData(since, until);

        // --- Role-based filtering ---
        // Marketing Manager cannot see raw $ figures
        const redact = !isAdmin;

        const account = {
            ...data.account,
            totalSpend: redact ? null : data.account.totalSpend,
        };

        const campaigns = data.campaigns.map(c => ({
            ...c,
            spend: redact ? null : c.spend,
            cpm: redact ? null : c.cpm,
            cpc: redact ? null : c.cpc,
            costPerResult: redact ? null : c.costPerResult,
            // ROAS % (ratio) is visible to Sharia, raw $ spend is not
            roas: c.roas,
        }));

        const dailySpend = data.dailySpend.map(d => ({
            ...d,
            spend: redact ? null : d.spend,
        }));

        return NextResponse.json({
            isConfigured: isMetaAdsConfigured(),
            isMock: data.isMock,
            account,
            campaigns,
            dailySpend,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('/api/paid-ads/meta error:', message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
