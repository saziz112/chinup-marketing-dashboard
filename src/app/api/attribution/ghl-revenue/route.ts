/**
 * /api/attribution/ghl-revenue
 * GET: Cross-references GHL opportunity contact emails with MindBody purchasing
 * clients to show real revenue generated per lead source.
 *
 * Query params:
 *   - period: '7d' | '30d' | '90d' (default '30d')
 *   - location: 'decatur' | 'smyrna' | 'kennesaw' (optional)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isGHLConfigured, getFullPipelineData, type LocationKey, type GHLOpportunity } from '@/lib/integrations/gohighlevel';
import { getClientEmailMap } from '@/lib/integrations/mindbody';
import { format, subDays } from 'date-fns';

interface SourceAccumulator {
    totalLeads: number;
    leadsWithEmail: number;
    matchedLeads: number;
    matchedRevenue: number;
    pipelineValue: number;
}

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

    const period = req.nextUrl.searchParams.get('period') || '30d';
    const locationParam = req.nextUrl.searchParams.get('location') as LocationKey | null;

    const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
    const endDate = new Date();
    const startDate = subDays(endDate, days);
    const mbStart = `${format(startDate, 'yyyy-MM-dd')}T00:00:00`;
    const mbEnd = `${format(endDate, 'yyyy-MM-dd')}T23:59:59`;

    try {
        // Fetch both data sources in parallel (both are cached)
        const [pipelineData, clientEmailMap] = await Promise.all([
            getFullPipelineData({ locationFilter: locationParam || undefined }),
            getClientEmailMap(mbStart, mbEnd),
        ]);

        // Extract ALL open opportunities from pipeline data
        const allOpps: GHLOpportunity[] = pipelineData.locations
            .flatMap(loc => loc.pipelines
                .flatMap(p => p.stages
                    .flatMap(s => s.opportunities)));

        // Step 1: Track how many sources each email appears under (for revenue splitting)
        const emailSourceMap = new Map<string, Set<string>>();
        for (const opp of allOpps) {
            const email = opp.contactEmail?.toLowerCase().trim();
            if (!email) continue;
            const src = opp.source || 'Unknown';
            if (!emailSourceMap.has(email)) {
                emailSourceMap.set(email, new Set());
            }
            emailSourceMap.get(email)!.add(src);
        }

        // Step 2: Match and aggregate by source
        const sourceMap = new Map<string, SourceAccumulator>();
        const matchedEmails = new Set<string>(); // track unique matched emails

        for (const opp of allOpps) {
            const src = opp.source || 'Unknown';
            if (!sourceMap.has(src)) {
                sourceMap.set(src, {
                    totalLeads: 0,
                    leadsWithEmail: 0,
                    matchedLeads: 0,
                    matchedRevenue: 0,
                    pipelineValue: 0,
                });
            }
            const entry = sourceMap.get(src)!;
            entry.totalLeads++;
            entry.pipelineValue += opp.monetaryValue;

            const email = opp.contactEmail?.toLowerCase().trim();
            if (!email) continue;

            entry.leadsWithEmail++;

            const mbClient = clientEmailMap.get(email);
            if (mbClient && mbClient.revenue > 0) {
                // Split revenue if this email appears under multiple sources
                const numSources = emailSourceMap.get(email)?.size || 1;
                const splitRevenue = mbClient.revenue / numSources;

                entry.matchedLeads++;
                entry.matchedRevenue += splitRevenue;
                matchedEmails.add(email);
            }
        }

        // Build sorted source breakdown
        const sourceBreakdown = Array.from(sourceMap.entries())
            .map(([source, data]) => ({
                source,
                ...data,
                matchRate: data.leadsWithEmail > 0
                    ? Math.round((data.matchedLeads / data.leadsWithEmail) * 100)
                    : null,
                revenuePerLead: data.matchedLeads > 0
                    ? Math.round(data.matchedRevenue / data.matchedLeads)
                    : null,
            }))
            .sort((a, b) => b.matchedRevenue - a.matchedRevenue || b.totalLeads - a.totalLeads);

        // Totals
        const totalLeads = allOpps.length;
        const totalLeadsWithEmail = allOpps.filter(o => o.contactEmail?.trim()).length;
        const matchedLeads = matchedEmails.size;
        const matchedRevenue = sourceBreakdown.reduce((s, d) => s + d.matchedRevenue, 0);

        const response = {
            configured: true,
            period,
            startDate: format(startDate, 'yyyy-MM-dd'),
            endDate: format(endDate, 'yyyy-MM-dd'),
            totalLeads,
            totalLeadsWithEmail,
            matchedLeads,
            matchedRevenue: isAdmin ? Math.round(matchedRevenue) : 0,
            matchRate: totalLeadsWithEmail > 0
                ? Math.round((matchedLeads / totalLeadsWithEmail) * 100)
                : null,
            revenuePerLead: isAdmin && matchedLeads > 0
                ? Math.round(matchedRevenue / matchedLeads)
                : null,
            sourceBreakdown: isAdmin
                ? sourceBreakdown
                : sourceBreakdown.map(s => ({
                    ...s,
                    matchedRevenue: 0,
                    pipelineValue: 0,
                    revenuePerLead: null,
                })),
            attributionMethod: 'email_match' as const,
            attributionNote: `${matchedLeads} of ${totalLeadsWithEmail} GHL leads with emails matched to MindBody purchasing clients (${period} window). ` +
                `${totalLeads - totalLeadsWithEmail} leads had no email and could not be matched.`,
            fetchedAt: new Date().toISOString(),
        };

        return NextResponse.json(response);
    } catch (error: unknown) {
        console.error('[ghl-revenue] Error:', error);
        const message = error instanceof Error ? error.message : 'Failed to compute revenue attribution';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
