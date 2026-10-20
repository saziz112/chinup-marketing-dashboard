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
import { getClientEmailMapFromDB, getAppointmentsByClientIds } from '@/lib/integrations/mindbody-db';
import { sql } from '@/lib/db/sql';
import { getLocations } from '@/lib/integrations/gohighlevel';
import { summarizeMatchedRevenue, isWithinLeadRetention, LEAD_RETENTION_DAYS } from '@/lib/meta-roas';
import { format, subDays, startOfMonth } from 'date-fns';
import { pgCached } from '@/lib/pg-cache';

// Revenue syncs daily and spend moves slowly; an hour keeps it fresh enough.
const ROAS_CACHE_TTL_HOURS = 1;

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

        // Postgres-backed so repeat loads on any serverless instance skip the Meta and
        // MindBody round trips. Admin-only route, so one cached body fits every caller.
        const body = await pgCached(`roas_v1_${since}_${until}`, { ttlHours: ROAS_CACHE_TTL_HOURS }, () => buildRoasBody(since, until));
        return NextResponse.json(body);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('/api/paid-ads/roas error:', message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

async function buildRoasBody(since: string, until: string) {
    // Older windows would email-match only the few leads Meta still returns
    // and read as ~0x. Show spend, but no ROAS.
    if (!isWithinLeadRetention(since)) {
        const adsData = await getMetaAdsData(since, until);
        return {
            since,
            until,
            isConfigured: isMetaAdsConfigured(),
            isMock: adsData.isMock,
            attributionMethod: 'outside_lead_retention',
            attributionNote: `True ROAS isn't available for this window. Meta only keeps lead form submissions for ${LEAD_RETENTION_DAYS} days, so most of these leads can't be matched anymore. Pick a range inside the last ${LEAD_RETENTION_DAYS} days.`,
            metaSpend: Math.round((adsData.account.totalSpend || 0) * 100) / 100,
            metaLeads: 0,
            hasLeadForms: true,
            matchedClients: 0,
            matchedRevenue: 0,
            priorPatientRevenue: 0,
            newPatientRevenue: 0,
            newPatientRoas: null,
            topPatientRevenue: 0,
            topPatientShare: 0,
            unmatchedLeads: 0,
            matchRate: null,
            matchedClientsDetails: [],
            trueRoas: null,
            costPerMatchedClient: null,
            metaPlatformRoas: 0,
            campaignBreakdown: [],
            totalAppointmentsBooked: 0,
            totalAppointmentsCompleted: 0,
        };
    }

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

    // Build GHL email→{contactId, locationId} map for matched leads
    const matchedEmails = [...new Set(
        leadData.leads.map(l => l.email?.toLowerCase().trim()).filter(Boolean)
    )] as string[];
    const ghlByEmail = new Map<string, { contactId: string; locationKey: string }>();
    if (matchedEmails.length > 0) {
        try {
            const rows = await sql`
                SELECT email, contact_id, location_key FROM ghl_contacts_map
                WHERE email = ANY(${matchedEmails})
            `;
            for (const r of rows.rows) {
                if (!ghlByEmail.has(r.email)) {
                    ghlByEmail.set(r.email, { contactId: r.contact_id, locationKey: r.location_key });
                }
            }
        } catch { /* table may not exist yet */ }
    }
    const locationIdByKey = new Map<string, string>();
    for (const loc of getLocations()) locationIdByKey.set(loc.key, loc.locationId);

    // First, count how many leads each email has to handle revenue splitting
    const emailLeadCounts = new Map<string, number>();
    for (const lead of leadData.leads) {
        if (!lead.email) continue;
        const email = lead.email.toLowerCase().trim();
        emailLeadCounts.set(email, (emailLeadCounts.get(email) || 0) + 1);
    }

    // --- Email matching ---
    const matchedClientsDetails: { email: string; clientName: string; revenue: number; leadDate: string; firstSaleDate: string | null; isPriorPatient: boolean; campaignId: string; campaignName: string; leadCost: number; isSplit: boolean; ghlUrl: string | null; ghlContactId: string | null; mbClientId: string | null }[] = [];
    const unmatchedLeads: { email: string; campaignId: string }[] = [];

    for (const lead of leadData.leads) {
        if (!lead.email) continue;
        const email = lead.email.toLowerCase().trim();
        const mbClient = clientEmailMap.get(email);

        // Matched = this lead's person bought something in the window. A client
        // record with $0 in the window is not a purchasing patient.
        if (mbClient && mbClient.revenue > 0) {
            // If the user submitted multiple lead forms, we split the revenue
            // equally across the campaigns to prevent double-counting total revenue.
            const numLeads = emailLeadCounts.get(email) || 1;
            const splitRevenue = mbClient.revenue / numLeads;

            const ghl = ghlByEmail.get(email);
            const ghlLocationId = ghl ? locationIdByKey.get(ghl.locationKey) : null;
            const ghlUrl = ghl && ghlLocationId
                ? `https://app.gohighlevel.com/v2/location/${ghlLocationId}/contacts/detail/${ghl.contactId}`
                : null;
            const mbClientId = mbClient.client.Id || null;

            matchedClientsDetails.push({
                email,
                clientName: `${mbClient.client.FirstName || ''} ${mbClient.client.LastName || ''}`.trim(),
                revenue: Math.round(splitRevenue * 100) / 100, // round to 2 decimals
                leadDate: lead.createdTime.slice(0, 10),
                firstSaleDate: mbClient.firstSaleDate ?? null,
                isPriorPatient: !!mbClient.firstSaleDate && mbClient.firstSaleDate < lead.createdTime.slice(0, 10),
                campaignId: lead.campaignId,
                campaignName: lead.campaignName,
                leadCost: campaignCostMap.get(lead.campaignId) || 0,
                isSplit: numLeads > 1,
                ghlUrl,
                ghlContactId: ghl?.contactId || null,
                mbClientId: mbClientId ? String(mbClientId) : null,
            });
        } else {
            unmatchedLeads.push({ email, campaignId: lead.campaignId });
        }
    }

    // Revenue from email-matched clients
    const revenueSummary = summarizeMatchedRevenue(matchedClientsDetails);
    const matchedRevenue = revenueSummary.totalRevenue;
    const matchedCount = revenueSummary.purchasingLeads;

    // Spend from Meta Ads
    const metaSpend = adsData.account.totalSpend;

    // --- Appointment attribution ---
    // Every lead with a client record counts here, purchased or not: a booked
    // appointment is funnel progress even before the first sale.
    const leadsWithClient = leadData.leads
        .filter(l => l.email)
        .map(l => ({ campaignId: l.campaignId, clientId: clientEmailMap.get(l.email!.toLowerCase().trim())?.client.Id }))
        .filter((l): l is { campaignId: string; clientId: string } => !!l.clientId);
    const matchedClientIds = [...new Set(leadsWithClient.map(l => l.clientId))];

    const appointmentMap = await getAppointmentsByClientIds(matchedClientIds, mbStart, mbEnd);

    // Build client→campaign mapping for appointment attribution
    const clientToCampaign = new Map<string, string[]>();
    for (const { clientId, campaignId } of leadsWithClient) {
        const campaigns = clientToCampaign.get(clientId) || [];
        if (!campaigns.includes(campaignId)) campaigns.push(campaignId);
        clientToCampaign.set(clientId, campaigns);
    }

    // Per-campaign matched revenue
    const campaignMatchMap = new Map<string, { revenue: number; matched: number }>();
    for (const m of matchedClientsDetails) {
        const entry = campaignMatchMap.get(m.campaignId) || { revenue: 0, matched: 0 };
        entry.revenue += m.revenue;
        entry.matched++;
        campaignMatchMap.set(m.campaignId, entry);
    }

    // Aggregate appointments per campaign
    const campaignApptMap = new Map<string, { booked: number; completed: number }>();
    for (const [clientId, appts] of appointmentMap) {
        const campaigns = clientToCampaign.get(clientId) || [];
        for (const cId of campaigns) {
            const entry = campaignApptMap.get(cId) || { booked: 0, completed: 0 };
            // If client is attributed to multiple campaigns, count for each
            entry.booked += appts.booked;
            entry.completed += appts.completed;
            campaignApptMap.set(cId, entry);
        }
    }

    const campaignBreakdown = adsData.campaigns.map(c => {
        const match = campaignMatchMap.get(c.id);
        const campaignLeads = leadData.byCampaign.get(c.id)?.length || 0;
        const campaignRevenue = match?.revenue || 0;
        const campaignMatched = match?.matched || 0;
        const appts = campaignApptMap.get(c.id);

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
            appointmentsBooked: appts?.booked || 0,
            appointmentsCompleted: appts?.completed || 0,
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
        attributionNote = `${matchedCount} of ${metaLeadsTotal} Meta leads became paying patients in this window, matched by email (${matchRate ?? 0}%)`;
    }

    return {
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
        matchedClients: revenueSummary.purchasingPatients,
        matchedRevenue: Math.round(matchedRevenue * 100) / 100,
        priorPatientRevenue: Math.round(revenueSummary.priorPatientRevenue * 100) / 100,
        newPatientRevenue: Math.round(revenueSummary.newPatientRevenue * 100) / 100,
        newPatientRoas: metaSpend > 0 ? Math.round((revenueSummary.newPatientRevenue / metaSpend) * 100) / 100 : null,
        topPatientRevenue: Math.round(revenueSummary.topPatientRevenue * 100) / 100,
        topPatientShare: Math.round(revenueSummary.topPatientShare * 1000) / 1000,
        unmatchedLeads: unmatchedLeads.length,
        matchRate,
        matchedClientsDetails,
        // Calculated ROAS
        trueRoas,
        costPerMatchedClient: revenueSummary.purchasingPatients > 0 && metaSpend > 0
            ? Math.round((metaSpend / revenueSummary.purchasingPatients) * 100) / 100
            : null,
        // Meta platform ROAS (for comparison), spend-weighted across campaigns
        metaPlatformRoas: (() => {
            const spend = adsData.campaigns.reduce((s, c) => s + c.spend, 0);
            return spend > 0
                ? Math.round((adsData.campaigns.reduce((s, c) => s + c.roas * c.spend, 0) / spend) * 100) / 100
                : 0;
        })(),
        // Per-campaign
        campaignBreakdown,
        // Appointment funnel: each client counted once, even when attributed to several campaigns
        totalAppointmentsBooked: [...appointmentMap.values()].reduce((s, a) => s + a.booked, 0),
        totalAppointmentsCompleted: [...appointmentMap.values()].reduce((s, a) => s + a.completed, 0),
    };
}
