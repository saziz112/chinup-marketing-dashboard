import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getMetaAdsData, isMetaAdsConfigured } from '@/lib/integrations/meta-ads';
import { getGoogleAdsData, isGoogleAdsConfigured } from '@/lib/integrations/google-ads';
import { subDays, format } from 'date-fns';

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
        const redact = !isAdmin;

        // --- Date range ---
        const since = request.nextUrl.searchParams.get('since') || defaultSince;
        const until = request.nextUrl.searchParams.get('until') || defaultUntil;

        // --- Fetch Concurrent ---
        const [metaData, googleData] = await Promise.all([
            getMetaAdsData(since, until),
            getGoogleAdsData(since, until)
        ]);

        // --- Aggregate Account Metrics ---
        const rawTotalSpend = (metaData.account.totalSpend || 0) + (googleData.account.totalSpend || 0);
        const totalLeads = (metaData.account.totalResults || 0) + (googleData.account.totalResults || 0);
        const totalClicks = (metaData.account.totalClicks || 0) + (googleData.account.totalClicks || 0);
        const totalImpressions = (metaData.account.totalImpressions || 0) + (googleData.account.totalImpressions || 0);

        let cpl = 0;
        if (totalLeads > 0) {
            cpl = rawTotalSpend / totalLeads;
        }

        // We do not have blended ROAS calculated perfectly here yet unless we grab attribution revenue,
        // but we'll attach a placeholder for the frontend to compute if needed, or omit it.

        const account = {
            totalSpend: redact ? null : rawTotalSpend,
            totalLeads,
            totalClicks,
            totalImpressions,
            cpl: redact ? null : cpl,
        };

        // --- Combine Campaigns ---
        const mCampaigns = metaData.campaigns.map(c => ({
            ...c,
            platform: 'Meta Ads',
            spend: redact ? null : c.spend,
            cpm: redact ? null : c.cpm,
            cpc: redact ? null : c.cpc,
            costPerResult: redact ? null : c.costPerResult,
            roas: c.roas,
        }));

        const gCampaigns = googleData.campaigns.map(c => ({
            ...c,
            platform: 'Google Ads',
            spend: redact ? null : c.spend,
            cpm: redact ? null : c.cpm,
            cpc: redact ? null : c.cpc,
            costPerResult: redact ? null : c.costPerResult,
            roas: c.roas,
        }));

        const campaigns = [...mCampaigns, ...gCampaigns];

        // --- Combine Daily Spend ---
        // Map date -> { metaSpend, googleSpend, metaLeads, googleLeads, clicks }
        const dailyMap: Record<string, { metaSpend: number, googleSpend: number, metaLeads: number, googleLeads: number, clicks: number }> = {};

        metaData.dailySpend.forEach(d => {
            if (!dailyMap[d.date]) dailyMap[d.date] = { metaSpend: 0, googleSpend: 0, metaLeads: 0, googleLeads: 0, clicks: 0 };
            dailyMap[d.date].metaSpend = d.spend;
            dailyMap[d.date].metaLeads = d.results;
            dailyMap[d.date].clicks += d.clicks || 0;
        });

        googleData.dailySpend.forEach(d => {
            if (!dailyMap[d.date]) dailyMap[d.date] = { metaSpend: 0, googleSpend: 0, metaLeads: 0, googleLeads: 0, clicks: 0 };
            dailyMap[d.date].googleSpend = d.spend;
            dailyMap[d.date].googleLeads = d.results || 0;
            dailyMap[d.date].clicks += d.clicks || 0;
        });

        const dailySpend = Object.keys(dailyMap).sort().map(date => {
            const data = dailyMap[date];
            return {
                date,
                spend: redact ? null : (data.metaSpend + data.googleSpend), // Legacy key for older charts
                results: data.metaLeads + data.googleLeads, // Legacy key
                clicks: data.clicks,
                metaSpend: redact ? null : data.metaSpend,
                googleSpend: redact ? null : data.googleSpend,
                metaLeads: data.metaLeads,
                googleLeads: data.googleLeads,
                totalSpend: redact ? null : (data.metaSpend + data.googleSpend),
                totalLeads: data.metaLeads + data.googleLeads
            };
        });

        return NextResponse.json({
            isConfigured: {
                meta: isMetaAdsConfigured(),
                google: isGoogleAdsConfigured()
            },
            isMock: metaData.isMock || googleData.isMock,
            account,
            campaigns,
            dailySpend,
        });

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('/api/paid-ads/overview error:', message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
