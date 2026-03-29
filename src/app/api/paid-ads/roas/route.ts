/**
 * True ROAS via Email-Based Cross-Attribution
 *
 * Methodology:
 *   1. Pull real lead form submissions from Meta Lead Ads API
 *      → Each lead has: email, name, phone, campaign ID
 *   2. Pull purchasing MindBody clients with their emails
 *   3. Match on email (case-insensitive, trimmed)
 *      → This is IDENTITY-LEVEL matching, not guessed referral sources
 *   4. Sum revenue for matched clients
 *
 * True ROAS = MindBody revenue (email-matched) ÷ Meta Ads spend
 *
 * Note: Email matching only works for Lead Generation campaigns using native
 * Facebook/Instagram lead forms. Traffic campaigns (website clicks/awareness)
 * don't produce lead records on the Meta side — for those, we fall back to
 * showing spend and reach metrics without conversion validation.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getMetaAdsData, getMetaLeads, isMetaAdsConfigured } from '@/lib/integrations/meta-ads';
import { getClientEmailMapFromDB } from '@/lib/integrations/mindbody-db';
import { format, subDays, startOfMonth } from 'date-fns';

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
        if (user.isAdmin !== true) {
            return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
        }

        const since = request.nextUrl.searchParams.get('since') || defaultSince;
        const until = request.nextUrl.searchParams.get('until') || defaultUntil;

        const mbStart = `${since}T00:00:00`;
        const mbEnd = `${until}T23:59:59`;

        // Fetch all three data sources in parallel
        const [adsData, leadData, clientEmailMap] = await Promise.all([
            getMetaAdsData(since, until),
            getMetaLeads(since, until),
            getClientEmailMapFromDB(mbStart, mbEnd),
        ]);

        const campaignCostMap = new Map(adsData.campaigns.map(c => [c.id, c.costPerResult]));

        // Build name→id map from ads campaigns for fallback matching.
        // When Meta's lead API doesn't return campaign_id, the lead's campaignId
        // falls back to the form ID, which won't match any ads campaign. We remap
        // by matching the lead's campaignName to an ads campaign name.
        const campaignNameToId = new Map<string, string>();
        for (const c of adsData.campaigns) {
            campaignNameToId.set(c.name.toLowerCase().trim(), c.id);
        }
        // Also index by known campaign IDs so we can detect which leads need remapping
        const knownCampaignIds = new Set(adsData.campaigns.map(c => c.id));

        // Remap lead campaignIds that don't match any ads campaign
        for (const lead of leadData.leads) {
            if (!knownCampaignIds.has(lead.campaignId) && lead.campaignName) {
                const match = campaignNameToId.get(lead.campaignName.toLowerCase().trim());
                if (match) {
                    lead.campaignId = match;
                }
            }
        }
        // Also rebuild byCampaign map after remapping
        leadData.byCampaign.clear();
        for (const lead of leadData.leads) {
            const arr = leadData.byCampaign.get(lead.campaignId) || [];
            arr.push(lead);
            leadData.byCampaign.set(lead.campaignId, arr);
        }

        // First, count how many leads each email has to handle revenue splitting
        const emailLeadCounts = new Map<string, number>();
        for (const lead of leadData.leads) {
            if (!lead.email) continue;
            const email = lead.email.toLowerCase().trim();
            emailLeadCounts.set(email, (emailLeadCounts.get(email) || 0) + 1);
        }

        // --- Email matching ---
        const matchedClientsDetails: { email: string; clientName: string; revenue: number; campaignId: string; campaignName: string; leadCost: number; isSplit: boolean }[] = [];
        const unmatchedLeads: { email: string; campaignId: string }[] = [];

        for (const lead of leadData.leads) {
            if (!lead.email) continue;
            const email = lead.email.toLowerCase().trim();
            const mbClient = clientEmailMap.get(email);

            if (mbClient) {
                // If the user submitted multiple lead forms, we split the revenue
                // equally across the campaigns to prevent double-counting total revenue.
                const numLeads = emailLeadCounts.get(email) || 1;
                const splitRevenue = mbClient.revenue / numLeads;

                matchedClientsDetails.push({
                    email,
                    clientName: `${mbClient.client.FirstName || ''} ${mbClient.client.LastName || ''}`.trim(),
                    revenue: Math.round(splitRevenue * 100) / 100, // round to 2 decimals
                    campaignId: lead.campaignId,
                    campaignName: lead.campaignName,
                    leadCost: campaignCostMap.get(lead.campaignId) || 0,
                    isSplit: numLeads > 1,
                });
            } else {
                unmatchedLeads.push({ email, campaignId: lead.campaignId });
            }
        }

        // Revenue from email-matched clients
        const matchedRevenue = matchedClientsDetails.reduce((sum, c) => sum + c.revenue, 0);
        const matchedCount = matchedClientsDetails.length;

        // Spend from Meta Ads
        const metaSpend = adsData.account.totalSpend;

        // Per-campaign matched revenue
        const campaignMatchMap = new Map<string, { revenue: number; matched: number }>();
        for (const m of matchedClientsDetails) {
            const entry = campaignMatchMap.get(m.campaignId) || { revenue: 0, matched: 0 };
            entry.revenue += m.revenue;
            entry.matched++;
            campaignMatchMap.set(m.campaignId, entry);
        }

        const campaignBreakdown = adsData.campaigns.map(c => {
            const match = campaignMatchMap.get(c.id);
            const campaignLeads = leadData.byCampaign.get(c.id)?.length || 0;
            const campaignRevenue = match?.revenue || 0;
            const campaignMatched = match?.matched || 0;

            // If there's spend but no revenue, ROAS is 0. If no spend, ROAS is null (not calculable)
            let trueRoas: number | null = null;
            if (c.spend !== null && c.spend > 0) {
                trueRoas = campaignRevenue > 0 ? Math.round((campaignRevenue / c.spend) * 100) / 100 : 0;
            }

            return {
                id: c.id,
                name: c.name,
                status: c.status,
                spend: c.spend || 0,
                metaLeads: campaignLeads,
                mbMatchedClients: campaignMatched,
                matchedRevenue: Math.round(campaignRevenue * 100) / 100,
                trueRoas,
                matchRate: campaignLeads > 0 ? Math.round((campaignMatched / campaignLeads) * 100) : null,
            };
        });

        // Overall True ROAS
        // Same logic: if spend exists, return a number (even if 0)
        let trueRoas: number | null = null;
        if (metaSpend !== null && metaSpend > 0) {
            trueRoas = matchedRevenue > 0 ? Math.round((matchedRevenue / metaSpend) * 100) / 100 : 0;
        }

        const metaLeadsTotal = leadData.totalLeads;
        const matchRate = metaLeadsTotal > 0
            ? Math.round((matchedCount / metaLeadsTotal) * 100)
            : null;

        // Attribution method label
        let attributionMethod = 'email_match';
        let attributionNote: string;
        if (!leadData.hasLeadForms) {
            attributionMethod = 'no_lead_forms';
            attributionNote = 'No native Facebook lead forms detected. Run Lead Generation campaigns to enable email-level attribution.';
        } else if (metaLeadsTotal === 0) {
            attributionMethod = 'lead_forms_empty';
            attributionNote = 'Lead forms found but no submissions in this period. Try a wider date range.';
        } else {
            attributionNote = `${matchedCount} of ${metaLeadsTotal} Meta leads matched to MindBody clients by email (${matchRate ?? 0}% match rate)`;
        }

        return NextResponse.json({
            since,
            until,
            isConfigured: isMetaAdsConfigured(),
            isMock: adsData.isMock,
            attributionMethod,
            attributionNote,
            // Meta spend
            metaSpend: Math.round((metaSpend || 0) * 100) / 100,
            metaLeads: metaLeadsTotal,
            hasLeadForms: leadData.hasLeadForms,
            // MindBody matched
            matchedClients: matchedCount,
            matchedRevenue: Math.round(matchedRevenue * 100) / 100,
            unmatchedLeads: unmatchedLeads.length,
            matchRate,
            matchedClientsDetails,
            // Calculated ROAS
            trueRoas,
            costPerMatchedClient: matchedCount > 0 && metaSpend > 0
                ? Math.round((metaSpend / matchedCount) * 100) / 100
                : null,
            // Meta platform ROAS (for comparison)
            metaPlatformRoas: adsData.campaigns.length > 0
                ? Math.round((adsData.campaigns.reduce((s, c) => s + c.roas, 0) / adsData.campaigns.length) * 100) / 100
                : 0,
            // Per-campaign
            campaignBreakdown,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('/api/paid-ads/roas error:', message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
