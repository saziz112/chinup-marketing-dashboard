import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getGoogleAdsData, getGhlGoogleLeads, enrichGhlLeadsWithMindBodyAndCampaigns, isGoogleAdsConfigured } from '@/lib/integrations/google-ads';
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

        // --- Date range ---
        const since = request.nextUrl.searchParams.get('since') || defaultSince;
        const until = request.nextUrl.searchParams.get('until') || defaultUntil;

        // --- Fetch ---
        const [data, ghlLeadsResult] = await Promise.all([
            getGoogleAdsData(since, until),
            getGhlGoogleLeads(since, until),
        ]);

        // --- Enrich GHL leads with MindBody revenue + per-campaign attribution ---
        const enriched = await enrichGhlLeadsWithMindBodyAndCampaigns(
            ghlLeadsResult.opportunities,
            data.campaigns,
            since,
            until,
        );

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

        // Aggregate revenue + appointments for the KPI card subtitle
        const totalGhlRevenue = enriched.leads.reduce((s, l) => s + l.mbRevenue, 0);
        const totalGhlBooked = enriched.leads.reduce((s, l) => s + l.mbBooked, 0);
        const totalGhlCompleted = enriched.leads.reduce((s, l) => s + l.mbCompleted, 0);
        const totalSpend = data.account.totalSpend || 0;
        const ghlTrueRoas = totalSpend > 0 ? Math.round((totalGhlRevenue / totalSpend) * 100) / 100 : null;

        return NextResponse.json({
            isConfigured: isGoogleAdsConfigured(),
            isMock: data.isMock,
            account,
            campaigns,
            dailySpend,
            ghlLeads: ghlLeadsResult.count,
            ghlLeadsDetails: redact ? enriched.leads.map(l => ({ ...l, mbRevenue: 0 })) : enriched.leads,
            ghlCampaignBreakdown: redact ? enriched.campaignBreakdown.map(b => ({ ...b, matchedRevenue: 0 })) : enriched.campaignBreakdown,
            ghlTotalRevenue: redact ? null : Math.round(totalGhlRevenue * 100) / 100,
            ghlTrueRoas: redact ? null : ghlTrueRoas,
            ghlAppointmentsBooked: totalGhlBooked,
            ghlAppointmentsCompleted: totalGhlCompleted,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('/api/paid-ads/google error:', message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
