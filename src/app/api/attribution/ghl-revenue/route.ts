/**
 * /api/attribution/ghl-revenue
 * GET: Cross-references GHL opportunity contacts with MindBody purchasing
 * clients to show real revenue generated per lead source.
 *
 * Matching: email first, then phone fallback. GHL opportunities are
 * filtered to only those created within the selected period.
 *
 * Query params:
 *   - period: '7d' | '30d' | '90d' (default '30d')
 *   - location: 'decatur' | 'smyrna' | 'kennesaw' (optional)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isGHLConfigured, getFullPipelineData, type LocationKey, type GHLOpportunity } from '@/lib/integrations/gohighlevel';
import { getClientMatchMaps, normalizePhone } from '@/lib/integrations/mindbody';
import { format, subDays } from 'date-fns';

interface SourceAccumulator {
    totalLeads: number;
    leadsWithContact: number; // leads with email OR phone
    matchedLeads: number;
    matchedRevenue: number;
    pipelineValue: number;
    emailMatches: number;
    phoneMatches: number;
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
        const [pipelineData, { emailMap, phoneMap }] = await Promise.all([
            getFullPipelineData({ locationFilter: locationParam || undefined }),
            getClientMatchMaps(mbStart, mbEnd),
        ]);

        // Extract opportunities and filter to selected period
        const allOpps: GHLOpportunity[] = pipelineData.locations
            .flatMap(loc => loc.pipelines
                .flatMap(p => p.stages
                    .flatMap(s => s.opportunities)));

        const filteredOpps = allOpps.filter(opp => {
            const created = new Date(opp.createdAt);
            return created >= startDate && created <= endDate;
        });

        // Step 1: Track how many sources each contact appears under (for revenue splitting)
        // Key by MindBody client ID to avoid double-counting across email/phone
        const clientSourceMap = new Map<string, Set<string>>();

        for (const opp of filteredOpps) {
            const src = opp.source || 'Unknown';
            const mbClient = resolveClient(opp, emailMap, phoneMap);
            if (!mbClient) continue;
            const cid = mbClient.client.Id;
            if (!clientSourceMap.has(cid)) clientSourceMap.set(cid, new Set());
            clientSourceMap.get(cid)!.add(src);
        }

        // Step 2: Match and aggregate by source
        const sourceMap = new Map<string, SourceAccumulator>();
        const matchedClientIds = new Set<string>(); // track unique matched clients

        for (const opp of filteredOpps) {
            const src = opp.source || 'Unknown';
            if (!sourceMap.has(src)) {
                sourceMap.set(src, {
                    totalLeads: 0,
                    leadsWithContact: 0,
                    matchedLeads: 0,
                    matchedRevenue: 0,
                    pipelineValue: 0,
                    emailMatches: 0,
                    phoneMatches: 0,
                });
            }
            const entry = sourceMap.get(src)!;
            entry.totalLeads++;
            entry.pipelineValue += opp.monetaryValue;

            const hasEmail = !!opp.contactEmail?.trim();
            const hasPhone = !!opp.contactPhone?.trim();
            if (hasEmail || hasPhone) entry.leadsWithContact++;

            // Try email match first, then phone fallback
            const mbClient = resolveClient(opp, emailMap, phoneMap);
            if (mbClient && mbClient.revenue > 0) {
                const cid = mbClient.client.Id;
                // Split revenue if this client appears under multiple sources
                const numSources = clientSourceMap.get(cid)?.size || 1;
                const splitRevenue = mbClient.revenue / numSources;

                entry.matchedLeads++;
                entry.matchedRevenue += splitRevenue;
                matchedClientIds.add(cid);

                // Track match method
                if (hasEmail && emailMap.has(opp.contactEmail!.toLowerCase().trim())) {
                    entry.emailMatches++;
                } else {
                    entry.phoneMatches++;
                }
            }
        }

        // Build sorted source breakdown
        const sourceBreakdown = Array.from(sourceMap.entries())
            .map(([source, data]) => ({
                source,
                totalLeads: data.totalLeads,
                leadsWithContact: data.leadsWithContact,
                matchedLeads: data.matchedLeads,
                matchedRevenue: data.matchedRevenue,
                pipelineValue: data.pipelineValue,
                emailMatches: data.emailMatches,
                phoneMatches: data.phoneMatches,
                matchRate: data.leadsWithContact > 0
                    ? Math.round((data.matchedLeads / data.leadsWithContact) * 100)
                    : null,
                revenuePerLead: data.matchedLeads > 0
                    ? Math.round(data.matchedRevenue / data.matchedLeads)
                    : null,
            }))
            .sort((a, b) => b.matchedRevenue - a.matchedRevenue || b.totalLeads - a.totalLeads);

        // Totals
        const totalLeads = filteredOpps.length;
        const totalLeadsWithContact = filteredOpps.filter(o =>
            o.contactEmail?.trim() || o.contactPhone?.trim()
        ).length;
        const matchedLeads = matchedClientIds.size;
        const matchedRevenue = sourceBreakdown.reduce((s, d) => s + d.matchedRevenue, 0);
        const totalEmailMatches = sourceBreakdown.reduce((s, d) => s + d.emailMatches, 0);
        const totalPhoneMatches = sourceBreakdown.reduce((s, d) => s + d.phoneMatches, 0);

        const response = {
            configured: true,
            period,
            startDate: format(startDate, 'yyyy-MM-dd'),
            endDate: format(endDate, 'yyyy-MM-dd'),
            totalLeads,
            totalLeadsWithContact,
            matchedLeads,
            matchedRevenue: isAdmin ? Math.round(matchedRevenue) : 0,
            matchRate: totalLeadsWithContact > 0
                ? Math.round((matchedLeads / totalLeadsWithContact) * 100)
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
            attributionMethod: 'email_and_phone_match' as const,
            attributionNote: `${matchedLeads} of ${totalLeadsWithContact} GHL leads matched to MindBody purchasing clients (${period} window). ` +
                `${totalEmailMatches} via email, ${totalPhoneMatches} via phone. ` +
                `${totalLeads - totalLeadsWithContact} leads had no contact info. ` +
                `${allOpps.length - filteredOpps.length} older leads outside ${period} window excluded.`,
            fetchedAt: new Date().toISOString(),
        };

        return NextResponse.json(response);
    } catch (error: unknown) {
        console.error('[ghl-revenue] Error:', error);
        const message = error instanceof Error ? error.message : 'Failed to compute revenue attribution';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

/** Resolve a GHL opportunity to a MindBody client via email (priority) or phone (fallback) */
function resolveClient(
    opp: GHLOpportunity,
    emailMap: Map<string, { client: { Id: string }; revenue: number }>,
    phoneMap: Map<string, { client: { Id: string }; revenue: number }>,
) {
    // Try email first
    const email = opp.contactEmail?.toLowerCase().trim();
    if (email) {
        const match = emailMap.get(email);
        if (match) return match;
    }
    // Phone fallback
    const rawPhone = opp.contactPhone?.trim();
    if (rawPhone) {
        const phone = normalizePhone(rawPhone);
        if (phone.length === 10) {
            const match = phoneMap.get(phone);
            if (match) return match;
        }
    }
    return null;
}
