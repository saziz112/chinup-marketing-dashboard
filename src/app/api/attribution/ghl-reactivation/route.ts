/**
 * /api/attribution/ghl-reactivation
 * GET: Returns eligible contacts for SMS re-activation campaign (9 campaign types)
 * POST: Sends SMS campaign to selected contacts
 * Admin-only
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { type LocationKey, isGHLConfigured, getStaleLeads } from '@/lib/integrations/gohighlevel';
import {
    getConversationsIntelligence,
    getLapsedPatients,
    getCancelledAppointments,
    getConsultOnlyPatients,
    buildPhoneMap,
} from '@/lib/integrations/ghl-conversations';
import { sendBulkSMS, SMS_TEMPLATES } from '@/lib/integrations/ghl-messaging';

const LOCATION_NAMES: Record<LocationKey, string> = {
    decatur: 'Decatur',
    smyrna: 'Smyrna/Vinings',
    kennesaw: 'Kennesaw',
};

function maskPhone(phone: string): string {
    return phone.length > 4
        ? phone.slice(0, -4).replace(/\d/g, '*') + phone.slice(-4)
        : '****';
}

function buildForecast(
    contacts: { monetaryValue?: number; achievabilityScore?: number }[],
    responseRate: number,
) {
    const targetCount = contacts.length;
    const smsCostPerMessage = 0.02;
    const estimatedCost = targetCount * smsCostPerMessage;
    const predictedResponses = Math.round(targetCount * responseRate);
    const bookingRate = 0.35;
    const predictedBookings = Math.round(predictedResponses * bookingRate);
    const avgTreatmentValue = contacts.length > 0
        ? contacts.reduce((sum, c) => sum + (c.monetaryValue || 500), 0) / contacts.length
        : 500;
    const projectedRevenue = Math.round(predictedBookings * avgTreatmentValue);
    const projectedROI = estimatedCost > 0 ? Math.round((projectedRevenue - estimatedCost) / estimatedCost) : 0;
    const avgAchievability = contacts.length > 0
        ? Math.round(contacts.reduce((sum, c) => sum + (c.achievabilityScore || 50), 0) / contacts.length)
        : 0;

    return {
        targetContacts: targetCount,
        estimatedCost: Math.round(estimatedCost * 100) / 100,
        predictedResponseRate: Math.round(responseRate * 100),
        predictedResponses,
        predictedBookings,
        projectedRevenue,
        projectedROI,
        avgAchievabilityScore: avgAchievability,
    };
}

export async function GET(req: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const user = session.user as Record<string, unknown>;
    if (user.isAdmin !== true) {
        return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    if (!isGHLConfigured()) {
        return NextResponse.json({ error: 'GoHighLevel not configured' }, { status: 503 });
    }

    const locationParam = req.nextUrl.searchParams.get('location') as LocationKey | null;
    const segment = req.nextUrl.searchParams.get('segment') || 'pipeline-followup';

    try {
        // ── Campaign 1: Cancelled / No-Show Appointments ──
        if (segment === 'cancelled') {
            const cancelled = await getCancelledAppointments(locationParam || undefined);
            const withPhone = cancelled.filter(c => c.phone);
            const sendable = withPhone.filter(c => c.ghlContactId);
            const phoneMap = await buildPhoneMap(locationParam || undefined);
            const contacts = sendable.filter(c => {
                const entry = phoneMap.get(c.phone.replace(/\D/g, '').slice(-10));
                return !entry?.dnd;
            }).map(c => ({
                contactId: c.ghlContactId!,
                contactName: c.ghlContactName || `${c.firstName} ${c.lastName}`.trim(),
                firstName: c.firstName,
                phone: c.phone,
                maskedPhone: maskPhone(c.phone),
                locationKey: c.locationKey || locationParam || 'decatur' as LocationKey,
                locationName: LOCATION_NAMES[c.locationKey || locationParam || 'decatur' as LocationKey] || 'Chin Up!',
                stageName: `Cancelled — ${c.serviceName}`,
                monetaryValue: 500,
                daysSinceOutreach: Math.floor((Date.now() - new Date(c.appointmentDate).getTime()) / 86400000),
                achievabilityScore: 80,
                riskLevel: 'going-cold' as const,
                tags: [] as string[],
                serviceName: c.serviceName,
            }));

            return NextResponse.json({
                contacts,
                totalEligible: contacts.length,
                segment,
                forecast: buildForecast(contacts, 0.30),
                templates: SMS_TEMPLATES,
                dndFiltered: sendable.length - contacts.length,
                source: 'mindbody-appointments',
                debug: {
                    totalCancelledFromMB: cancelled.length,
                    withPhone: withPhone.length,
                    matchedToGHL: sendable.length,
                    phoneMapSize: phoneMap.size,
                    afterDND: contacts.length,
                    sampleNoPhone: cancelled.filter(c => !c.phone).slice(0, 3).map(c => `${c.firstName} ${c.lastName}`),
                    sampleNoGHL: withPhone.filter(c => !c.ghlContactId).slice(0, 3).map(c => `${c.firstName} (${c.phone.slice(-4)})`),
                },
            });
        }

        // ── Campaign 2: Engaged Leads (conversation-based) ──
        if (segment === 'engaged') {
            const intelligence = await getConversationsIntelligence({
                locationFilter: locationParam || undefined,
            });
            const eligible = intelligence.engagementGaps.filter(g => {
                const lc = g.engagement?.lifecycleStage;
                if (lc !== 'engaged' && lc !== 'quoted') return false;
                if (!g.engagement?.phone) return false;
                if (g.engagement?.isDND) return false;
                if (g.mindbodyMatch?.isActive) return false;
                return true;
            });
            const contacts = eligible.map(g => ({
                contactId: g.opportunity.contactId,
                contactName: g.opportunity.contactName,
                firstName: g.opportunity.contactName?.split(' ')[0] || '',
                phone: g.engagement?.phone || '',
                maskedPhone: maskPhone(g.engagement?.phone || ''),
                locationKey: g.locationKey,
                locationName: g.locationName,
                stageName: `${g.engagement?.lifecycleStage} — ${g.stageName}`,
                monetaryValue: g.monetaryValue,
                daysSinceOutreach: g.daysSinceOutreach,
                achievabilityScore: g.achievabilityScore,
                riskLevel: g.riskLevel,
                tags: [] as string[],
            }));
            return NextResponse.json({
                contacts,
                totalEligible: contacts.length,
                segment,
                forecast: buildForecast(contacts, 0.25),
                templates: SMS_TEMPLATES,
                dndFiltered: intelligence.summary.dndFiltered,
                source: 'ghl-conversations',
            });
        }

        // ── Campaign 3: Consult-Only Patients ──
        if (segment === 'consult-only') {
            const consultOnly = await getConsultOnlyPatients(locationParam || undefined);
            const sendable = consultOnly.filter(c => c.ghlContactId);
            const phoneMap = await buildPhoneMap(locationParam || undefined);
            const contacts = sendable.filter(c => {
                const entry = phoneMap.get(c.phone.replace(/\D/g, '').slice(-10));
                return !entry?.dnd;
            }).map(c => ({
                contactId: c.ghlContactId!,
                contactName: c.ghlContactName || `${c.firstName} ${c.lastName}`.trim(),
                firstName: c.firstName,
                phone: c.phone,
                maskedPhone: maskPhone(c.phone),
                locationKey: c.locationKey || locationParam || 'decatur' as LocationKey,
                locationName: LOCATION_NAMES[c.locationKey || locationParam || 'decatur' as LocationKey] || 'Chin Up!',
                stageName: `Consulted — ${c.consultService}`,
                monetaryValue: 500,
                daysSinceOutreach: Math.floor((Date.now() - new Date(c.consultDate).getTime()) / 86400000),
                achievabilityScore: 70,
                riskLevel: 'going-cold' as const,
                tags: [] as string[],
            }));
            return NextResponse.json({
                contacts,
                totalEligible: contacts.length,
                totalFound: consultOnly.length,
                totalMatchedToGHL: sendable.length,
                segment,
                forecast: buildForecast(contacts, 0.22),
                templates: SMS_TEMPLATES,
                dndFiltered: sendable.length - contacts.length,
                source: 'mindbody-appointments',
            });
        }

        // ── Campaign 5: Ghosted Quotes (conversation-based) ──
        if (segment === 'ghost') {
            const intelligence = await getConversationsIntelligence({
                locationFilter: locationParam || undefined,
            });
            const eligible = intelligence.engagementGaps.filter(g => {
                if (g.engagement?.lifecycleStage !== 'ghost') return false;
                if (!g.engagement?.phone) return false;
                if (g.engagement?.isDND) return false;
                if (g.mindbodyMatch?.isActive) return false;
                return true;
            });
            const contacts = eligible.map(g => ({
                contactId: g.opportunity.contactId,
                contactName: g.opportunity.contactName,
                firstName: g.opportunity.contactName?.split(' ')[0] || '',
                phone: g.engagement?.phone || '',
                maskedPhone: maskPhone(g.engagement?.phone || ''),
                locationKey: g.locationKey,
                locationName: g.locationName,
                stageName: `Ghost — ${g.stageName}`,
                monetaryValue: g.monetaryValue,
                daysSinceOutreach: g.daysSinceOutreach,
                achievabilityScore: g.achievabilityScore,
                riskLevel: g.riskLevel,
                tags: [] as string[],
            }));
            return NextResponse.json({
                contacts,
                totalEligible: contacts.length,
                segment,
                forecast: buildForecast(contacts, 0.18),
                templates: SMS_TEMPLATES,
                dndFiltered: intelligence.summary.dndFiltered,
                source: 'ghl-conversations',
            });
        }

        // ── Campaign 7: Pipeline Follow-Up (ALL stale leads, no 150 cap) ──
        if (segment === 'pipeline-followup') {
            const staleLeads = await getStaleLeads(locationParam || undefined);
            const phoneMap = await buildPhoneMap(locationParam || undefined);

            const withPhone = staleLeads.filter(sl => sl.opportunity.contactPhone);
            const noDND = withPhone.filter(sl => {
                const entry = phoneMap.get(sl.opportunity.contactPhone.replace(/\D/g, '').slice(-10));
                if (entry?.dnd) return false;
                if ((sl.opportunity.contactTags || []).some(t => /dnd|do.not.disturb|opted.out|unsubscribe/i.test(t))) return false;
                if (sl.opportunity.contactDND) return false;
                return true;
            });

            const contacts = noDND.map(sl => ({
                contactId: sl.opportunity.contactId,
                contactName: sl.opportunity.contactName,
                firstName: sl.opportunity.contactName?.split(' ')[0] || '',
                phone: sl.opportunity.contactPhone,
                maskedPhone: maskPhone(sl.opportunity.contactPhone),
                locationKey: sl.locationKey,
                locationName: sl.locationName,
                stageName: `${sl.pipelineName} — ${sl.stageName}`,
                monetaryValue: sl.opportunity.monetaryValue,
                daysSinceOutreach: sl.daysSinceActivity,
                achievabilityScore: sl.staleness === 'at-risk' ? 70 : sl.staleness === 'stale' ? 45 : 25,
                riskLevel: sl.staleness === 'at-risk' ? 'needs-outreach' as const
                    : sl.staleness === 'stale' ? 'going-cold' as const
                    : 'abandoned' as const,
                tags: sl.opportunity.contactTags || [],
            }));

            return NextResponse.json({
                contacts,
                totalEligible: contacts.length,
                segment,
                forecast: buildForecast(contacts, 0.12),
                templates: SMS_TEMPLATES,
                dndFiltered: withPhone.length - noDND.length,
                source: 'ghl-pipeline',
                debug: {
                    totalStaleLeads: staleLeads.length,
                    withPhone: withPhone.length,
                    noPhone: staleLeads.length - withPhone.length,
                    afterDND: noDND.length,
                    phoneMapSize: phoneMap.size,
                    sampleLeads: staleLeads.slice(0, 3).map(sl => ({
                        name: sl.opportunity.contactName,
                        phone: sl.opportunity.contactPhone ? `...${sl.opportunity.contactPhone.slice(-4)}` : 'EMPTY',
                        days: sl.daysSinceActivity,
                        staleness: sl.staleness,
                    })),
                },
            });
        }

        // ── Campaign 8: Untouched Leads ──
        if (segment === 'untouched') {
            // Use stale leads in first pipeline stage (position 0 = never moved)
            const staleLeads = await getStaleLeads(locationParam || undefined);
            const phoneMap = await buildPhoneMap(locationParam || undefined);

            const untouched = staleLeads.filter(sl => {
                if (!sl.opportunity.contactPhone) return false;
                // First stage = likely never worked
                if (sl.opportunity.pipelineStageId !== sl.opportunity.pipelineId) {
                    // We don't have stage position directly, but leads in first stage
                    // are the oldest stale + haven't moved stages
                }
                // DND check
                const entry = phoneMap.get(sl.opportunity.contactPhone.replace(/\D/g, '').slice(-10));
                if (entry?.dnd) return false;
                if ((sl.opportunity.contactTags || []).some(t => /dnd|do.not.disturb|opted.out|unsubscribe/i.test(t))) return false;
                if (sl.opportunity.contactDND) return false;
                return true;
            });

            // Also try conversation-based untouched (from deep analysis)
            let conversationUntouched: {
                contactId: string; contactName: string; firstName: string;
                phone: string; maskedPhone: string; locationKey: string;
                locationName: string; stageName: string; monetaryValue: number;
                daysSinceOutreach: number; achievabilityScore: number;
                riskLevel: 'abandoned'; tags: string[];
            }[] = [];
            try {
                const intelligence = await getConversationsIntelligence({
                    locationFilter: locationParam || undefined,
                });
                conversationUntouched = intelligence.engagementGaps
                    .filter(g => {
                        if (g.engagement?.lifecycleStage !== 'untouched') return false;
                        if (!g.engagement?.phone) return false;
                        if (g.engagement?.isDND) return false;
                        return true;
                    })
                    .map(g => ({
                        contactId: g.opportunity.contactId,
                        contactName: g.opportunity.contactName,
                        firstName: g.opportunity.contactName?.split(' ')[0] || '',
                        phone: g.engagement?.phone || '',
                        maskedPhone: maskPhone(g.engagement?.phone || ''),
                        locationKey: g.locationKey,
                        locationName: g.locationName,
                        stageName: `Untouched — ${g.stageName}`,
                        monetaryValue: g.monetaryValue,
                        daysSinceOutreach: g.daysSinceOutreach,
                        achievabilityScore: g.achievabilityScore,
                        riskLevel: 'abandoned' as const,
                        tags: [] as string[],
                    }));
            } catch {
                // Conversation analysis might not be cached yet
            }

            // Merge: use conversation-analyzed first (more accurate), then add from stale leads
            const seenIds = new Set(conversationUntouched.map(c => c.contactId));
            const contacts = [
                ...conversationUntouched,
                ...untouched
                    .filter(sl => !seenIds.has(sl.opportunity.contactId))
                    .slice(0, 100) // Cap to avoid huge lists
                    .map(sl => ({
                        contactId: sl.opportunity.contactId,
                        contactName: sl.opportunity.contactName,
                        firstName: sl.opportunity.contactName?.split(' ')[0] || '',
                        phone: sl.opportunity.contactPhone,
                        maskedPhone: maskPhone(sl.opportunity.contactPhone),
                        locationKey: sl.locationKey,
                        locationName: sl.locationName,
                        stageName: `Untouched — ${sl.stageName}`,
                        monetaryValue: sl.opportunity.monetaryValue,
                        daysSinceOutreach: sl.daysSinceActivity,
                        achievabilityScore: sl.daysSinceActivity < 30 ? 55 : 30,
                        riskLevel: 'abandoned' as const,
                        tags: sl.opportunity.contactTags || [],
                    })),
            ];

            return NextResponse.json({
                contacts,
                totalEligible: contacts.length,
                segment,
                forecast: buildForecast(contacts, 0.12),
                templates: SMS_TEMPLATES,
                dndFiltered: 0,
                source: 'ghl-mixed',
            });
        }

        // ── Campaigns 4, 6, 9: Lapsed Patient Segments (MindBody-based) ──
        if (segment.startsWith('lapsed')) {
            const minDays = segment === 'lapsed-recent' ? 60
                : segment === 'lapsed-vip' ? 120
                : segment === 'lapsed-long' ? 180
                : 60;

            const lapsedPatients = await getLapsedPatients(minDays, locationParam || undefined);

            // VIP filter: $500+ revenue for lapsed-vip
            let filtered = lapsedPatients;
            if (segment === 'lapsed-vip') {
                filtered = lapsedPatients.filter(p =>
                    p.totalRevenue >= 500 && p.daysSinceLastVisit >= 120 && p.daysSinceLastVisit <= 365
                );
            } else if (segment === 'lapsed-recent') {
                filtered = lapsedPatients.filter(p => p.daysSinceLastVisit <= 120);
            }

            // Filter to GHL-matched + DND check
            const phoneMap = await buildPhoneMap(locationParam || undefined);
            const sendable = filtered.filter(p => {
                if (!p.ghlContactId) return false;
                // DND check from phone map
                const normalized = p.phone.replace(/\D/g, '').slice(-10);
                const entry = phoneMap.get(normalized);
                if (entry?.dnd) return false;
                return true;
            });

            const contacts = sendable.map(p => ({
                contactId: p.ghlContactId!,
                contactName: p.ghlContactName || `${p.firstName} ${p.lastName}`.trim(),
                firstName: p.firstName,
                phone: p.phone,
                maskedPhone: maskPhone(p.phone),
                locationKey: p.locationKey || locationParam || 'decatur' as LocationKey,
                locationName: LOCATION_NAMES[p.locationKey || locationParam || 'decatur' as LocationKey] || 'Chin Up!',
                stageName: `MindBody — ${p.segment}`,
                monetaryValue: p.totalRevenue,
                daysSinceOutreach: p.daysSinceLastVisit,
                achievabilityScore: p.daysSinceLastVisit < 90 ? 65
                    : p.daysSinceLastVisit < 180 ? 40
                    : 20,
                riskLevel: p.segment === 'recent-lapse' ? 'going-cold' as const
                    : 'abandoned' as const,
                tags: [] as string[],
                mbRevenue: p.totalRevenue,
                mbLastVisit: p.lastSaleDate,
            }));

            const responseRate = segment === 'lapsed-recent' ? 0.20
                : segment === 'lapsed-vip' ? 0.22
                : segment === 'lapsed-long' ? 0.06
                : 0.12;

            return NextResponse.json({
                contacts,
                totalEligible: contacts.length,
                segment,
                forecast: buildForecast(contacts, responseRate),
                templates: SMS_TEMPLATES,
                dndFiltered: filtered.filter(p => p.ghlContactId).length - sendable.length,
                source: 'mindbody',
                debug: {
                    totalLapsedFromMB: lapsedPatients.length,
                    afterSegmentFilter: filtered.length,
                    withPhone: filtered.filter(p => p.phone).length,
                    matchedToGHL: filtered.filter(p => p.ghlContactId).length,
                    afterDND: sendable.length,
                    phoneMapSize: phoneMap.size,
                    sampleNoGHL: filtered.filter(p => !p.ghlContactId).slice(0, 3).map(p => `${p.firstName} (${p.phone?.slice(-4) || 'no phone'})`),
                },
            });
        }

        // Fallback: unknown segment
        return NextResponse.json({ error: `Unknown segment: ${segment}`, contacts: [], totalEligible: 0 }, { status: 400 });

    } catch (error: unknown) {
        console.error('[ghl-reactivation] Error:', error);
        const message = error instanceof Error ? error.message : 'Failed to fetch eligible contacts';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user as Record<string, unknown>;
    if (user.isAdmin !== true) {
        return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    try {
        const body = await req.json();
        const {
            contactIds,
            message,
            locationKey,
            contacts: contactsData,
        }: {
            contactIds: string[];
            message: string;
            locationKey: LocationKey;
            contacts: { contactId: string; contactName: string; firstName: string; phone: string; tags: string[] }[];
        } = body;

        if (!contactIds || contactIds.length === 0) {
            return NextResponse.json({ error: 'No contacts selected' }, { status: 400 });
        }
        if (contactIds.length > 200) {
            return NextResponse.json({ error: 'Maximum 200 contacts per campaign' }, { status: 400 });
        }
        if (!message || message.trim().length === 0) {
            return NextResponse.json({ error: 'Message is required' }, { status: 400 });
        }
        if (!locationKey) {
            return NextResponse.json({ error: 'Location is required' }, { status: 400 });
        }

        // Filter to only selected contacts
        const selectedContacts = contactsData.filter(c => contactIds.includes(c.contactId));

        const result = await sendBulkSMS(
            locationKey,
            selectedContacts,
            message,
            LOCATION_NAMES[locationKey] || 'Chin Up!',
        );

        return NextResponse.json({
            ...result,
            message: `Campaign complete: ${result.sent} sent, ${result.failed} failed, ${result.skipped} skipped`,
            sentBy: session.user.email,
            sentAt: new Date().toISOString(),
        });
    } catch (error: unknown) {
        console.error('[ghl-reactivation] POST Error:', error);
        const message = error instanceof Error ? error.message : 'Failed to send campaign';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
