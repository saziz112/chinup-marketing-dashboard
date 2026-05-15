import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getGoogleAdsData, getGhlGoogleLeads, enrichGhlLeadsWithMindBody, isGoogleAdsConfigured } from '@/lib/integrations/google-ads';
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

        // --- Enrich GHL leads with MindBody revenue (account-level totals only) ---
        const enriched = await enrichGhlLeadsWithMindBody(
            ghlLeadsResult.opportunities,
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
            roas: c.roas,
        }));

        const dailySpend = data.dailySpend.map(d => ({
            ...d,
            spend: redact ? null : d.spend,
        }));

        // True ROAS at the account level: total MindBody revenue from email-matched
        // Google-sourced GHL leads, divided by total Google Ads spend.
        const totalSpend = data.account.totalSpend || 0;
        const ghlTrueRoas = totalSpend > 0
            ? Math.round((enriched.totals.totalRevenue / totalSpend) * 100) / 100
            : null;

        return NextResponse.json({
            isConfigured: isGoogleAdsConfigured(),
            isMock: data.isMock,
            account,
            campaigns,
            dailySpend,
            ghlLeads: enriched.totals.totalLeads,
            ghlLeadsDetails: redact ? enriched.leads.map(l => ({ ...l, mbRevenue: 0 })) : enriched.leads,
            ghlTotalRevenue: redact ? null : enriched.totals.totalRevenue,
            ghlMatchedClients: enriched.totals.mbMatchedClients,
            ghlMatchRate: enriched.totals.mbMatchRate,
            ghlTrueRoas: redact ? null : ghlTrueRoas,
            ghlAppointmentsBooked: enriched.totals.appointmentsBooked,
            ghlAppointmentsCompleted: enriched.totals.appointmentsCompleted,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('/api/paid-ads/google error:', message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
