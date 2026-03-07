/**
 * /api/attribution/ghl-reactivation
 * GET: Returns eligible contacts for SMS re-activation campaign
 * POST: Sends SMS campaign to selected contacts
 * Admin-only
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { type LocationKey, isGHLConfigured } from '@/lib/integrations/gohighlevel';
import { getConversationsIntelligence, getLapsedPatients } from '@/lib/integrations/ghl-conversations';
import { sendBulkSMS, isDNDContact, SMS_TEMPLATES } from '@/lib/integrations/ghl-messaging';

const LOCATION_NAMES: Record<LocationKey, string> = {
    decatur: 'Decatur',
    smyrna: 'Smyrna/Vinings',
    kennesaw: 'Kennesaw',
};

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
    const segment = req.nextUrl.searchParams.get('segment') || 'stale'; // at-risk, stale, dormant, lapsed-recent, lapsed, lapsed-long

    try {
        // Handle lapsed patient segments (MindBody-based)
        const isLapsedSegment = segment.startsWith('lapsed');
        if (isLapsedSegment) {
            const minDays = segment === 'lapsed-recent' ? 60
                : segment === 'lapsed' ? 90
                : segment === 'lapsed-long' ? 180
                : 60;

            const lapsedPatients = await getLapsedPatients(minDays, locationParam || undefined);

            // Filter to only those matched to GHL (we need contactId to send SMS)
            const sendable = lapsedPatients.filter(p => p.ghlContactId);

            const contacts = sendable.map(p => {
                const maskedPhone = p.phone.length > 4
                    ? p.phone.slice(0, -4).replace(/\d/g, '*') + p.phone.slice(-4)
                    : '****';

                return {
                    contactId: p.ghlContactId!,
                    contactName: p.ghlContactName || `${p.firstName} ${p.lastName}`.trim(),
                    firstName: p.firstName,
                    phone: p.phone,
                    maskedPhone,
                    locationKey: p.locationKey || locationParam || 'decatur' as LocationKey,
                    locationName: LOCATION_NAMES[p.locationKey || locationParam || 'decatur' as LocationKey] || 'Chin Up!',
                    stageName: `MindBody — ${p.segment}`,
                    monetaryValue: p.totalRevenue,
                    daysSinceOutreach: p.daysSinceLastVisit,
                    achievabilityScore: p.daysSinceLastVisit < 90 ? 65
                        : p.daysSinceLastVisit < 180 ? 40
                        : 20,
                    riskLevel: p.segment === 'recent-lapse' ? 'going-cold' as const
                        : p.segment === 'lapsed' ? 'abandoned' as const
                        : 'abandoned' as const,
                    tags: [] as string[],
                    mbRevenue: p.totalRevenue,
                    mbLastVisit: p.lastSaleDate,
                };
            });

            const targetCount = contacts.length;
            const smsCostPerMessage = 0.02;
            const estimatedCost = targetCount * smsCostPerMessage;
            // Lapsed patients have higher response rates since they already know the business
            const responseRate = segment === 'lapsed-recent' ? 0.25 : segment === 'lapsed' ? 0.12 : 0.06;
            const predictedResponses = Math.round(targetCount * responseRate);
            const bookingRate = 0.40;
            const predictedBookings = Math.round(predictedResponses * bookingRate);
            const avgTreatmentValue = contacts.length > 0
                ? contacts.reduce((sum, c) => sum + c.monetaryValue, 0) / contacts.length
                : 500;
            const projectedRevenue = Math.round(predictedBookings * avgTreatmentValue);
            const projectedROI = estimatedCost > 0 ? Math.round((projectedRevenue - estimatedCost) / estimatedCost) : 0;

            return NextResponse.json({
                contacts,
                totalEligible: contacts.length,
                totalLapsedFound: lapsedPatients.length,
                totalMatchedToGHL: sendable.length,
                segment,
                forecast: {
                    targetContacts: targetCount,
                    estimatedCost: Math.round(estimatedCost * 100) / 100,
                    predictedResponseRate: Math.round(responseRate * 100),
                    predictedResponses,
                    predictedBookings,
                    projectedRevenue,
                    projectedROI,
                    avgAchievabilityScore: contacts.length > 0
                        ? Math.round(contacts.reduce((sum, c) => sum + c.achievabilityScore, 0) / contacts.length)
                        : 0,
                },
                templates: SMS_TEMPLATES,
                dndFiltered: 0,
                source: 'mindbody',
            });
        }

        // Standard GHL engagement-gap-based segments
        const intelligence = await getConversationsIntelligence({
            locationFilter: locationParam || undefined,
        });

        // Filter engagement gaps by segment
        const segmentMap: Record<string, string[]> = {
            'at-risk': ['needs-outreach'],
            'stale': ['going-cold'],
            'dormant': ['abandoned'],
            'all': ['needs-outreach', 'going-cold', 'abandoned'],
        };
        const riskLevels = segmentMap[segment] || segmentMap['stale'];

        const eligibleGaps = intelligence.engagementGaps.filter(g => {
            if (!riskLevels.includes(g.riskLevel)) return false;
            // Must have phone, not DND
            const phone = g.engagement?.phone;
            if (!phone) return false;
            if (g.engagement?.isDND) return false;
            // Skip MindBody active patients (they don't need re-activation)
            if (g.mindbodyMatch?.isActive) return false;
            return true;
        });

        // Build contact list with masked phone numbers
        const contacts = eligibleGaps.map(g => {
            const phone = g.engagement?.phone || '';
            const maskedPhone = phone.length > 4
                ? phone.slice(0, -4).replace(/\d/g, '*') + phone.slice(-4)
                : '****';

            return {
                contactId: g.opportunity.contactId,
                contactName: g.opportunity.contactName,
                firstName: g.opportunity.contactName?.split(' ')[0] || '',
                phone: phone,
                maskedPhone,
                locationKey: g.locationKey,
                locationName: g.locationName,
                stageName: g.stageName,
                monetaryValue: g.monetaryValue,
                daysSinceOutreach: g.daysSinceOutreach,
                achievabilityScore: g.achievabilityScore,
                riskLevel: g.riskLevel,
                tags: g.engagement?.isDND ? ['DND'] : [],
            };
        });

        // Campaign forecast
        const targetCount = contacts.length;
        const smsCostPerMessage = 0.02; // average estimate
        const estimatedCost = targetCount * smsCostPerMessage;

        // Predicted response rates by segment
        const responseRates: Record<string, number> = {
            'needs-outreach': 0.30,
            'going-cold': 0.15,
            'abandoned': 0.07,
        };
        const avgResponseRate = contacts.length > 0
            ? contacts.reduce((sum, c) => sum + (responseRates[c.riskLevel] || 0.15), 0) / contacts.length
            : 0.15;
        const predictedResponses = Math.round(targetCount * avgResponseRate);
        const bookingRate = 0.35; // of those who respond
        const predictedBookings = Math.round(predictedResponses * bookingRate);
        const avgTreatmentValue = contacts.length > 0
            ? contacts.reduce((sum, c) => sum + c.monetaryValue, 0) / contacts.length
            : 500;
        const projectedRevenue = Math.round(predictedBookings * avgTreatmentValue);
        const projectedROI = estimatedCost > 0 ? Math.round((projectedRevenue - estimatedCost) / estimatedCost) : 0;

        // Avg achievability score
        const avgAchievability = contacts.length > 0
            ? Math.round(contacts.reduce((sum, c) => sum + c.achievabilityScore, 0) / contacts.length)
            : 0;

        return NextResponse.json({
            contacts,
            totalEligible: contacts.length,
            segment,
            forecast: {
                targetContacts: targetCount,
                estimatedCost: Math.round(estimatedCost * 100) / 100,
                predictedResponseRate: Math.round(avgResponseRate * 100),
                predictedResponses,
                predictedBookings,
                projectedRevenue,
                projectedROI,
                avgAchievabilityScore: avgAchievability,
            },
            templates: SMS_TEMPLATES,
            dndFiltered: intelligence.summary.dndFiltered,
            source: 'ghl',
        });
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
