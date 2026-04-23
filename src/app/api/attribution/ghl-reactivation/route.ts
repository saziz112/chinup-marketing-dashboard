/**
 * /api/attribution/ghl-reactivation
 * GET: Returns eligible contacts for SMS/Email re-activation campaigns (6 campaigns)
 * POST: Sends SMS or Email campaign to selected contacts + records history
 * Admin-only
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sql } from '@/lib/db/sql';
import { type LocationKey, isGHLConfigured, getLocations } from '@/lib/integrations/gohighlevel';
import {
    getConversationsIntelligence,
    getLapsedPatients,
    getCancelledAppointments,
    getConsultOnlyPatients,
    buildUnifiedPhoneMap,
    getRecentOutboundContactIds,
    getV2SmsDndContactIds,
} from '@/lib/integrations/ghl-conversations';
import {
    sendBulkSMS, sendBulkEmail, SMS_TEMPLATES, EMAIL_TEMPLATES,
    sendSMS, sendEmail, renderTemplate,
} from '@/lib/integrations/ghl-messaging';
import { hashPhone, hashEmail } from '@/lib/dnd-check';
import { normalizePhone } from '@/lib/integrations/mindbody';

export const maxDuration = 300; // 5 min — cold-start fetches MindBody + GHL for all 3 locations

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

/**
 * Get phone hashes contacted in the last 30 days (global cooldown).
 */
async function getRecentlyContactedHashes(): Promise<Set<string>> {
    try {
        const result = await sql`
            SELECT DISTINCT phone_hash FROM campaign_contacts
            WHERE sent_at > NOW() - INTERVAL '30 days'
            AND status = 'sent'
            AND phone_hash IS NOT NULL
        `;
        return new Set(result.rows.map(r => r.phone_hash));
    } catch {
        return new Set(); // Table may not exist yet
    }
}

/**
 * Get last campaign run per segment.
 */
async function getLastCampaignRuns(): Promise<Record<string, { runAt: string; totalSent: number; channel: string }>> {
    try {
        const result = await sql`
            SELECT DISTINCT ON (segment) segment, run_at, total_sent, channel
            FROM campaign_runs
            ORDER BY segment, run_at DESC
        `;
        const runs: Record<string, { runAt: string; totalSent: number; channel: string }> = {};
        for (const r of result.rows) {
            runs[r.segment] = { runAt: r.run_at, totalSent: r.total_sent, channel: r.channel };
        }
        return runs;
    } catch {
        return {};
    }
}

type ContactEntry = {
    contactId: string;
    contactName: string;
    firstName: string;
    phone: string;
    email?: string;
    maskedPhone: string;
    locationKey: LocationKey;
    locationName: string;
    stageName: string;
    monetaryValue: number;
    daysSinceOutreach: number;
    achievabilityScore: number;
    riskLevel: 'needs-outreach' | 'going-cold' | 'abandoned';
    tags: string[];
    mbRevenue?: number;
    mbLastVisit?: string;
    serviceName?: string;
    lastTreatmentType?: string;
};

/**
 * Apply 30-day global cooldown: remove contacts whose phone hash was contacted recently.
 */
function applyCooldown(
    contacts: ContactEntry[],
    recentHashes: Set<string>,
): { filtered: ContactEntry[]; cooldownExcluded: number } {
    if (recentHashes.size === 0) return { filtered: contacts, cooldownExcluded: 0 };
    const filtered = contacts.filter(c => {
        const ph = hashPhone(c.phone);
        return !recentHashes.has(ph);
    });
    return { filtered, cooldownExcluded: contacts.length - filtered.length };
}

/**
 * Apply 7-day outbound message cooldown: remove contacts who received an outbound
 * message (SMS/email) via GHL within the last 7 days.
 */
function applyOutboundCooldown(
    contacts: ContactEntry[],
    recentOutboundIds: Set<string>,
): { filtered: ContactEntry[]; outboundExcluded: number } {
    if (recentOutboundIds.size === 0) return { filtered: contacts, outboundExcluded: 0 };
    const filtered = contacts.filter(c => !recentOutboundIds.has(c.contactId));
    return { filtered, outboundExcluded: contacts.length - filtered.length };
}

/**
 * Apply v2 per-channel SMS DND check. The v1 pipeline API only returns the global
 * `dnd` boolean — misses contacts with per-channel DND (e.g. "Text Messages" only).
 * This calls v2 API to check `dndSettings.SMS.status` for each contact.
 */
const V2_DND_CHECK_LIMIT = 200; // Cap v2 API calls to avoid Vercel 60s timeout

async function applyV2SmsDnd(
    contacts: ContactEntry[],
): Promise<{ filtered: ContactEntry[]; v2DndFiltered: number }> {
    if (contacts.length === 0) return { filtered: contacts, v2DndFiltered: 0 };
    // Only check DND for first N contacts — v2 API calls are expensive (~1 per contact)
    const toCheck = contacts.slice(0, V2_DND_CHECK_LIMIT);
    const passThrough = contacts.slice(V2_DND_CHECK_LIMIT);
    const smsDndIds = await getV2SmsDndContactIds(
        toCheck.map(c => ({ contactId: c.contactId, locationKey: c.locationKey })),
    );
    if (smsDndIds.size === 0) return { filtered: contacts, v2DndFiltered: 0 };
    const checkedFiltered = toCheck.filter(c => !smsDndIds.has(c.contactId));
    return { filtered: [...checkedFiltered, ...passThrough], v2DndFiltered: toCheck.length - checkedFiltered.length };
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
    const treatmentParam = req.nextUrl.searchParams.get('treatment') || undefined;
    const actionParam = req.nextUrl.searchParams.get('action');

    // Return available treatments for dropdown (no auth beyond session check above)
    if (actionParam === 'treatments') {
        try {
            const { getAvailableTreatments } = await import('@/lib/integrations/mindbody-sync');
            const treatments = await getAvailableTreatments();
            return NextResponse.json({ treatments });
        } catch {
            return NextResponse.json({ treatments: [] });
        }
    }

    try {
        // Fetch cooldown hashes, last campaign runs, and outbound cooldown in parallel
        const [recentHashes, lastRuns, recentOutboundIds] = await Promise.all([
            getRecentlyContactedHashes(),
            getLastCampaignRuns(),
            getRecentOutboundContactIds(7),
        ]);

        // ── Campaign 1: Let's Reschedule (Cancelled / No-Show) ──
        if (segment === 'cancelled') {
            const cancelled = await getCancelledAppointments(locationParam || undefined);
            const sendable = cancelled.filter(c => c.ghlContactId);
            const phoneMap = await buildUnifiedPhoneMap(locationParam || undefined);
            const noDND = sendable.filter(c => {
                const normalized = normalizePhone(c.phone);
                const entry = phoneMap.get(normalized);
                return !entry?.dnd;
            });
            const contacts: ContactEntry[] = noDND.map(c => ({
                contactId: c.ghlContactId!,
                contactName: c.ghlContactName || `${c.firstName} ${c.lastName}`.trim(),
                firstName: c.firstName,
                phone: c.phone,
                email: phoneMap.get(normalizePhone(c.phone))?.contactEmail || '',
                maskedPhone: maskPhone(c.phone),
                locationKey: c.locationKey || locationParam || 'decatur' as LocationKey,
                locationName: LOCATION_NAMES[c.locationKey || locationParam || 'decatur' as LocationKey] || 'Chin Up!',
                stageName: `Cancelled — ${c.serviceName}`,
                monetaryValue: 500,
                daysSinceOutreach: Math.floor((Date.now() - new Date(c.appointmentDate).getTime()) / 86400000),
                achievabilityScore: 80,
                riskLevel: 'going-cold' as const,
                tags: phoneMap.get(normalizePhone(c.phone))?.tags || [],
                serviceName: c.serviceName,
            }));

            const { filtered: afterCooldown, cooldownExcluded } = applyCooldown(contacts, recentHashes);
            const { filtered: afterOutbound, outboundExcluded } = applyOutboundCooldown(afterCooldown, recentOutboundIds);
            const { filtered, v2DndFiltered } = await applyV2SmsDnd(afterOutbound);

            return NextResponse.json({
                contacts: filtered,
                totalEligible: filtered.length,
                segment,
                forecast: buildForecast(filtered, 0.30),
                templates: SMS_TEMPLATES,
                emailTemplates: EMAIL_TEMPLATES,
                dndFiltered: (sendable.length - noDND.length) + v2DndFiltered,
                cooldownExcluded,
                outboundExcluded,
                lastCampaign: lastRuns[segment] || null,
                source: 'mindbody-appointments',
            });
        }

        // ── Campaign 2: Consulted, Not Treated ──
        if (segment === 'consult-only') {
            const consultOnly = await getConsultOnlyPatients(locationParam || undefined);
            const sendable = consultOnly.filter(c => c.ghlContactId);
            const phoneMap = await buildUnifiedPhoneMap(locationParam || undefined);
            const noDND = sendable.filter(c => {
                const normalized = normalizePhone(c.phone);
                const entry = phoneMap.get(normalized);
                return !entry?.dnd;
            });
            const contacts: ContactEntry[] = noDND.map(c => ({
                contactId: c.ghlContactId!,
                contactName: c.ghlContactName || `${c.firstName} ${c.lastName}`.trim(),
                firstName: c.firstName,
                phone: c.phone,
                email: phoneMap.get(normalizePhone(c.phone))?.contactEmail || '',
                maskedPhone: maskPhone(c.phone),
                locationKey: c.locationKey || locationParam || 'decatur' as LocationKey,
                locationName: LOCATION_NAMES[c.locationKey || locationParam || 'decatur' as LocationKey] || 'Chin Up!',
                stageName: `Consulted — ${c.consultService}`,
                monetaryValue: 500,
                daysSinceOutreach: Math.floor((Date.now() - new Date(c.consultDate).getTime()) / 86400000),
                achievabilityScore: 70,
                riskLevel: 'going-cold' as const,
                tags: phoneMap.get(normalizePhone(c.phone))?.tags || [],
            }));

            const { filtered: afterCooldown, cooldownExcluded } = applyCooldown(contacts, recentHashes);
            const { filtered: afterOutbound, outboundExcluded } = applyOutboundCooldown(afterCooldown, recentOutboundIds);
            const { filtered, v2DndFiltered } = await applyV2SmsDnd(afterOutbound);

            return NextResponse.json({
                contacts: filtered,
                totalEligible: filtered.length,
                segment,
                forecast: buildForecast(filtered, 0.22),
                templates: SMS_TEMPLATES,
                emailTemplates: EMAIL_TEMPLATES,
                dndFiltered: (sendable.length - noDND.length) + v2DndFiltered,
                cooldownExcluded,
                outboundExcluded,
                lastCampaign: lastRuns[segment] || null,
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
            const contacts: ContactEntry[] = eligible.map(g => ({
                contactId: g.opportunity.contactId,
                contactName: g.opportunity.contactName,
                firstName: g.opportunity.contactName?.split(' ')[0] || '',
                phone: g.engagement?.phone || '',
                email: g.opportunity.contactEmail || '',
                maskedPhone: maskPhone(g.engagement?.phone || ''),
                locationKey: g.locationKey as LocationKey,
                locationName: g.locationName,
                stageName: `Ghost — ${g.stageName}`,
                monetaryValue: g.monetaryValue,
                daysSinceOutreach: g.daysSinceOutreach,
                achievabilityScore: g.achievabilityScore,
                riskLevel: g.riskLevel as ContactEntry['riskLevel'],
                tags: [] as string[],
            }));

            const { filtered: afterCooldown, cooldownExcluded } = applyCooldown(contacts, recentHashes);
            const { filtered: afterOutbound, outboundExcluded } = applyOutboundCooldown(afterCooldown, recentOutboundIds);
            const { filtered, v2DndFiltered } = await applyV2SmsDnd(afterOutbound);

            return NextResponse.json({
                contacts: filtered,
                totalEligible: filtered.length,
                segment,
                forecast: buildForecast(filtered, 0.18),
                templates: SMS_TEMPLATES,
                emailTemplates: EMAIL_TEMPLATES,
                dndFiltered: intelligence.summary.dndFiltered + v2DndFiltered,
                cooldownExcluded,
                outboundExcluded,
                lastCampaign: lastRuns[segment] || null,
                source: 'ghl-conversations',
            });
        }

        // ── Conversation-Based Segments (replace pipeline-followup) ──
        // These 4 segments use conversation lifecycle stages as the primary signal
        if (segment === 'untouched' || segment === 'attempted-no-reply' || segment === 're-engage-ghost' || segment === 'quoted-followup') {
            const intelligence = await getConversationsIntelligence({
                locationFilter: locationParam || undefined,
            });

            // Filter by lifecycle stage based on segment
            const eligible = intelligence.engagementGaps.filter(g => {
                if (!g.engagement?.phone) return false;
                if (g.engagement?.isDND) return false;
                if (g.mindbodyMatch?.isActive) return false;

                if (segment === 'untouched') {
                    return g.engagement.lifecycleStage === 'untouched';
                }
                if (segment === 'attempted-no-reply') {
                    return g.engagement.lifecycleStage === 'attempted' && g.daysSinceOutreach >= 7;
                }
                if (segment === 're-engage-ghost') {
                    return g.engagement.lifecycleStage === 'ghost'
                        && g.engagement.daysSinceLastContact !== null
                        && g.engagement.daysSinceLastContact >= 14
                        && g.engagement.daysSinceLastContact <= 60;
                }
                if (segment === 'quoted-followup') {
                    return g.engagement.lifecycleStage === 'quoted' && g.daysSinceOutreach >= 7;
                }
                return false;
            });

            const responseRates: Record<string, number> = {
                'untouched': 0.10,
                'attempted-no-reply': 0.08,
                're-engage-ghost': 0.18,
                'quoted-followup': 0.25,
            };

            const contacts: ContactEntry[] = eligible.map(g => ({
                contactId: g.opportunity.contactId,
                contactName: g.opportunity.contactName,
                firstName: g.opportunity.contactName?.split(' ')[0] || '',
                phone: g.engagement?.phone || '',
                email: g.opportunity.contactEmail || '',
                maskedPhone: maskPhone(g.engagement?.phone || ''),
                locationKey: g.locationKey as LocationKey,
                locationName: g.locationName,
                stageName: `${g.engagement.lifecycleStage} — ${g.stageName}`,
                monetaryValue: g.monetaryValue,
                daysSinceOutreach: g.daysSinceOutreach,
                achievabilityScore: g.achievabilityScore,
                riskLevel: g.riskLevel as ContactEntry['riskLevel'],
                tags: [] as string[],
            }));

            const { filtered: afterCooldown, cooldownExcluded } = applyCooldown(contacts, recentHashes);
            const { filtered: afterOutbound, outboundExcluded } = applyOutboundCooldown(afterCooldown, recentOutboundIds);
            const { filtered, v2DndFiltered } = await applyV2SmsDnd(afterOutbound);

            return NextResponse.json({
                contacts: filtered,
                totalEligible: filtered.length,
                segment,
                forecast: buildForecast(filtered, responseRates[segment] || 0.12),
                templates: SMS_TEMPLATES,
                emailTemplates: EMAIL_TEMPLATES,
                dndFiltered: intelligence.summary.dndFiltered + v2DndFiltered,
                cooldownExcluded,
                outboundExcluded,
                lastCampaign: lastRuns[segment] || null,
                source: 'ghl-conversations',
            });
        }

        // ── Campaigns 3-4: Lapsed Patient Segments (VIP + Long-Lapsed only) ──
        if (segment === 'lapsed-vip' || segment === 'lapsed-long') {
            const minDays = segment === 'lapsed-vip' ? 120 : 180;
            const lapsedPatients = await getLapsedPatients(minDays, locationParam || undefined, treatmentParam);

            let filtered = lapsedPatients;
            if (segment === 'lapsed-vip') {
                filtered = lapsedPatients.filter(p =>
                    p.totalRevenue >= 500 && p.daysSinceLastVisit >= 120 && p.daysSinceLastVisit <= 365
                );
            }

            // Phone-level dedup
            const seenPhones = new Set<string>();
            filtered = filtered.filter(p => {
                const normalized = normalizePhone(p.phone);
                if (seenPhones.has(normalized)) return false;
                seenPhones.add(normalized);
                return true;
            });

            // GHL-matched + DND check
            const phoneMap = await buildUnifiedPhoneMap(locationParam || undefined);
            const sendable = filtered.filter(p => {
                if (!p.ghlContactId) return false;
                const normalized = normalizePhone(p.phone);
                const entry = phoneMap.get(normalized);
                if (entry?.dnd) return false;
                return true;
            });

            const contacts: ContactEntry[] = sendable.map(p => ({
                contactId: p.ghlContactId!,
                contactName: p.ghlContactName || `${p.firstName} ${p.lastName}`.trim(),
                firstName: p.firstName,
                phone: p.phone,
                email: p.email || phoneMap.get(normalizePhone(p.phone))?.contactEmail || '',
                maskedPhone: maskPhone(p.phone),
                locationKey: p.locationKey || locationParam || 'decatur' as LocationKey,
                locationName: LOCATION_NAMES[p.locationKey || locationParam || 'decatur' as LocationKey] || 'Chin Up!',
                stageName: `MindBody — ${p.segment}`,
                monetaryValue: p.totalRevenue,
                daysSinceOutreach: p.daysSinceLastVisit,
                achievabilityScore: p.daysSinceLastVisit < 180 ? 55 : 30,
                riskLevel: 'abandoned' as const,
                tags: phoneMap.get(normalizePhone(p.phone))?.tags || [],
                mbRevenue: p.totalRevenue,
                mbLastVisit: p.lastSaleDate,
            }));

            const responseRate = segment === 'lapsed-vip' ? 0.22 : 0.06;
            const { filtered: afterCooldown, cooldownExcluded } = applyCooldown(contacts, recentHashes);
            const { filtered: afterOutbound, outboundExcluded } = applyOutboundCooldown(afterCooldown, recentOutboundIds);
            const { filtered: finalFiltered, v2DndFiltered } = await applyV2SmsDnd(afterOutbound);

            return NextResponse.json({
                contacts: finalFiltered,
                totalEligible: finalFiltered.length,
                segment,
                forecast: buildForecast(finalFiltered, responseRate),
                templates: SMS_TEMPLATES,
                emailTemplates: EMAIL_TEMPLATES,
                dndFiltered: (filtered.filter(p => p.ghlContactId).length - sendable.length) + v2DndFiltered,
                cooldownExcluded,
                outboundExcluded,
                lastCampaign: lastRuns[segment] || null,
                source: 'mindbody',
            });
        }

        // ── Campaign 7: Win-Back VIPs ($500+, 365+ days) ──
        if (segment === 'lapsed-winback') {
            const lapsedPatients = await getLapsedPatients(365, locationParam || undefined, treatmentParam);
            let filtered = lapsedPatients.filter(p => p.totalRevenue >= 500);

            // Phone-level dedup
            const seenPhones = new Set<string>();
            filtered = filtered.filter(p => {
                const normalized = normalizePhone(p.phone);
                if (seenPhones.has(normalized)) return false;
                seenPhones.add(normalized);
                return true;
            });

            // GHL-matched + DND check
            const phoneMap = await buildUnifiedPhoneMap(locationParam || undefined);
            const sendable = filtered.filter(p => {
                if (!p.ghlContactId) return false;
                const normalized = normalizePhone(p.phone);
                const entry = phoneMap.get(normalized);
                if (entry?.dnd) return false;
                return true;
            });

            const contacts: ContactEntry[] = sendable.map(p => ({
                contactId: p.ghlContactId!,
                contactName: p.ghlContactName || `${p.firstName} ${p.lastName}`.trim(),
                firstName: p.firstName,
                phone: p.phone,
                email: p.email || phoneMap.get(normalizePhone(p.phone))?.contactEmail || '',
                maskedPhone: maskPhone(p.phone),
                locationKey: p.locationKey || locationParam || 'decatur' as LocationKey,
                locationName: LOCATION_NAMES[p.locationKey || locationParam || 'decatur' as LocationKey] || 'Chin Up!',
                stageName: `Win-Back — ${p.lastTreatmentType || p.segment}`,
                monetaryValue: p.totalRevenue,
                daysSinceOutreach: p.daysSinceLastVisit,
                achievabilityScore: Math.max(15, 50 - Math.floor(p.daysSinceLastVisit / 30)),
                riskLevel: 'abandoned' as const,
                tags: phoneMap.get(normalizePhone(p.phone))?.tags || [],
                mbRevenue: p.totalRevenue,
                mbLastVisit: p.lastSaleDate,
                lastTreatmentType: p.lastTreatmentType,
            }));

            const { filtered: afterCooldown, cooldownExcluded } = applyCooldown(contacts, recentHashes);
            const { filtered: afterOutbound, outboundExcluded } = applyOutboundCooldown(afterCooldown, recentOutboundIds);
            const { filtered: finalFiltered, v2DndFiltered } = await applyV2SmsDnd(afterOutbound);

            return NextResponse.json({
                contacts: finalFiltered,
                totalEligible: finalFiltered.length,
                segment,
                forecast: buildForecast(finalFiltered, 0.06),
                templates: SMS_TEMPLATES,
                emailTemplates: EMAIL_TEMPLATES,
                dndFiltered: (filtered.filter(p => p.ghlContactId).length - sendable.length) + v2DndFiltered,
                cooldownExcluded,
                outboundExcluded,
                lastCampaign: lastRuns[segment] || null,
                source: 'mindbody',
            });
        }

        // ── Campaign 8: Treatment-Specific Lapsed (90+ days, filtered by treatment type) ──
        if (segment === 'lapsed-treatment') {
            if (!treatmentParam) {
                return NextResponse.json({ error: 'treatment parameter required for lapsed-treatment segment', contacts: [], totalEligible: 0 }, { status: 400 });
            }

            const lapsedPatients = await getLapsedPatients(90, locationParam || undefined, treatmentParam);

            // Phone-level dedup
            const seenPhones = new Set<string>();
            let filtered = lapsedPatients.filter(p => {
                const normalized = normalizePhone(p.phone);
                if (seenPhones.has(normalized)) return false;
                seenPhones.add(normalized);
                return true;
            });

            // GHL-matched + DND check
            const phoneMap = await buildUnifiedPhoneMap(locationParam || undefined);
            const sendable = filtered.filter(p => {
                if (!p.ghlContactId) return false;
                const normalized = normalizePhone(p.phone);
                const entry = phoneMap.get(normalized);
                if (entry?.dnd) return false;
                return true;
            });

            const contacts: ContactEntry[] = sendable.map(p => ({
                contactId: p.ghlContactId!,
                contactName: p.ghlContactName || `${p.firstName} ${p.lastName}`.trim(),
                firstName: p.firstName,
                phone: p.phone,
                email: p.email || phoneMap.get(normalizePhone(p.phone))?.contactEmail || '',
                maskedPhone: maskPhone(p.phone),
                locationKey: p.locationKey || locationParam || 'decatur' as LocationKey,
                locationName: LOCATION_NAMES[p.locationKey || locationParam || 'decatur' as LocationKey] || 'Chin Up!',
                stageName: `${treatmentParam} — ${p.segment}`,
                monetaryValue: p.totalRevenue,
                daysSinceOutreach: p.daysSinceLastVisit,
                achievabilityScore: p.daysSinceLastVisit < 180 ? 50 : 25,
                riskLevel: 'going-cold' as const,
                tags: phoneMap.get(normalizePhone(p.phone))?.tags || [],
                mbRevenue: p.totalRevenue,
                mbLastVisit: p.lastSaleDate,
                lastTreatmentType: p.lastTreatmentType,
            }));

            const { filtered: afterCooldown, cooldownExcluded } = applyCooldown(contacts, recentHashes);
            const { filtered: afterOutbound, outboundExcluded } = applyOutboundCooldown(afterCooldown, recentOutboundIds);
            const { filtered: finalFiltered, v2DndFiltered } = await applyV2SmsDnd(afterOutbound);

            return NextResponse.json({
                contacts: finalFiltered,
                totalEligible: finalFiltered.length,
                segment,
                treatment: treatmentParam,
                forecast: buildForecast(finalFiltered, 0.15),
                templates: SMS_TEMPLATES,
                emailTemplates: EMAIL_TEMPLATES,
                dndFiltered: (filtered.filter(p => p.ghlContactId).length - sendable.length) + v2DndFiltered,
                cooldownExcluded,
                outboundExcluded,
                lastCampaign: lastRuns[segment] || null,
                source: 'mindbody',
            });
        }

        // ── Campaign 9: Inquired But Never Booked (GHL contacts without MindBody match) ──
        if (segment === 'never-booked') {
            const phoneMap = await buildUnifiedPhoneMap(locationParam || undefined);

            // Get all MindBody client phones for cross-reference.
            // Normalize in JS (not just trusting the stored value) — older rows may
            // predate the sync-side normalization, and any non-10-digit values must
            // be discarded so they can't mask a legitimate GHL phone.
            let mbPhones = new Set<string>();
            try {
                const { sql: pgSql } = await import('@/lib/db/sql');
                const mbResult = await pgSql`SELECT DISTINCT phone FROM mb_clients_cache WHERE phone IS NOT NULL AND phone != ''`;
                for (const row of mbResult.rows) {
                    const p = normalizePhone(row.phone || '');
                    if (p.length === 10) mbPhones.add(p);
                }
            } catch {
                // Fallback: use current API-based purchasing clients
                try {
                    const startDate = new Date(Date.now() - 548 * 86400000).toISOString().split('T')[0];
                    const endDate = new Date().toISOString().split('T')[0];
                    const { getPurchasingClients } = await import('@/lib/integrations/mindbody');
                    const { clients } = await getPurchasingClients(startDate, endDate);
                    for (const c of clients) {
                        const phone = normalizePhone(c.MobilePhone || c.HomePhone || '');
                        if (phone.length === 10) mbPhones.add(phone);
                    }
                } catch { /* empty set = no filtering */ }
            }

            // Find GHL contacts whose phone is NOT in MindBody
            const neverBooked: ContactEntry[] = [];
            const seenPhones = new Set<string>();
            for (const [phone, entry] of phoneMap) {
                if (phone.length < 10) continue;
                if (seenPhones.has(phone)) continue;
                seenPhones.add(phone);
                if (mbPhones.has(phone)) continue; // They ARE in MindBody, skip
                if (entry.dnd) continue;

                neverBooked.push({
                    contactId: entry.contactId,
                    contactName: entry.contactName,
                    firstName: entry.contactName.split(' ')[0] || '',
                    phone,
                    email: entry.contactEmail || '',
                    maskedPhone: maskPhone(phone),
                    locationKey: entry.locationKey,
                    locationName: LOCATION_NAMES[entry.locationKey] || 'Chin Up!',
                    stageName: 'Inquired — Never Booked',
                    monetaryValue: 0,
                    daysSinceOutreach: 0,
                    achievabilityScore: 40,
                    riskLevel: 'going-cold' as const,
                    tags: entry.tags,
                });
            }

            const { filtered: afterCooldown, cooldownExcluded } = applyCooldown(neverBooked, recentHashes);
            const { filtered: afterOutbound, outboundExcluded } = applyOutboundCooldown(afterCooldown, recentOutboundIds);
            const { filtered: finalFiltered, v2DndFiltered } = await applyV2SmsDnd(afterOutbound);

            return NextResponse.json({
                contacts: finalFiltered,
                totalEligible: finalFiltered.length,
                segment,
                forecast: buildForecast(finalFiltered, 0.08),
                templates: SMS_TEMPLATES,
                emailTemplates: EMAIL_TEMPLATES,
                dndFiltered: v2DndFiltered,
                cooldownExcluded,
                outboundExcluded,
                lastCampaign: lastRuns[segment] || null,
                source: 'ghl-contacts',
            });
        }

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

        // ── Test Send Mode ──
        if (body.testMode) {
            const { channel, message, locationKey, testPhone, testEmail, subject } = body as {
                testMode: true;
                channel: 'sms' | 'email';
                message: string;
                locationKey: LocationKey;
                testPhone?: string;
                testEmail?: string;
                subject?: string;
            };

            if (!message) return NextResponse.json({ error: 'Message is required' }, { status: 400 });
            if (!locationKey) return NextResponse.json({ error: 'Location is required' }, { status: 400 });

            // Render template with admin defaults
            const rendered = renderTemplate(message, {
                firstName: 'Sam',
                locationName: LOCATION_NAMES[locationKey] || 'Chin Up!',
            });

            // Find test contact via v1 contacts search (JWT tokens — more reliable than v2 search)
            const phone = testPhone || '4046685785';
            const emailAddr = testEmail || 'saziz112@gmail.com';
            const searchQuery = channel === 'sms' ? phone.replace(/\D/g, '') : emailAddr;

            const allLocs = getLocations();
            // Try selected location first, then others
            const selectedLoc = allLocs.find(l => l.key === locationKey);
            const orderedLocs = selectedLoc
                ? [selectedLoc, ...allLocs.filter(l => l.key !== locationKey)]
                : allLocs;

            let foundContactId = '';
            let foundContactName = '';
            let foundLocKey: LocationKey = locationKey;

            for (const loc of orderedLocs) {
                try {
                    const res = await fetch(
                        `https://rest.gohighlevel.com/v1/contacts/?query=${encodeURIComponent(searchQuery)}&limit=1`,
                        { headers: { 'Authorization': `Bearer ${loc.apiKey}` } },
                    );
                    if (res.ok) {
                        const data = await res.json();
                        const contact = data.contacts?.[0];
                        if (contact?.id) {
                            foundContactId = contact.id;
                            foundContactName = contact.name || contact.contactName || `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'Test';
                            foundLocKey = loc.key;
                            break;
                        }
                    }
                } catch { /* try next location */ }
            }

            if (!foundContactId) {
                return NextResponse.json({
                    error: `Contact not found in any GHL location for ${channel === 'sms' ? `phone ${phone}` : `email ${emailAddr}`}. Add yourself as a contact in GHL first.`,
                }, { status: 404 });
            }

            // Get PIT for the location where contact was found (needed for v2 messaging)
            const pitEnvMap: Record<LocationKey, string> = {
                decatur: 'GHL_PIT_DECATUR',
                smyrna: 'GHL_PIT_SMYRNA',
                kennesaw: 'GHL_PIT_KENNESAW',
            };
            const locIdEnvMap: Record<LocationKey, string> = {
                decatur: 'GHL_LOCATION_ID_DECATUR',
                smyrna: 'GHL_LOCATION_ID_SMYRNA',
                kennesaw: 'GHL_LOCATION_ID_KENNESAW',
            };
            const pit = process.env[pitEnvMap[foundLocKey]] || '';
            const locId = process.env[locIdEnvMap[foundLocKey]] || '';

            if (channel === 'sms') {
                const result = await sendSMS(locId, pit, foundContactId, rendered);
                return NextResponse.json({
                    testMode: true,
                    channel: 'sms',
                    recipient: phone,
                    contactId: foundContactId,
                    contactName: foundContactName,
                    renderedMessage: rendered,
                    ...result,
                });
            } else {
                const result = await sendEmail(locId, pit, foundContactId, rendered, subject || 'Chin Up! Aesthetics');
                return NextResponse.json({
                    testMode: true,
                    channel: 'email',
                    recipient: emailAddr,
                    contactId: foundContactId,
                    contactName: foundContactName,
                    renderedMessage: rendered,
                    ...result,
                });
            }
        }

        // ── Bulk Campaign Send ──
        const {
            contactIds,
            message,
            locationKey,
            contacts: contactsData,
            channel = 'sms',
            segment,
            subject,
        }: {
            contactIds: string[];
            message: string;
            locationKey: LocationKey;
            contacts: { contactId: string; contactName: string; firstName: string; phone: string; email?: string; tags: string[] }[];
            channel?: 'sms' | 'email';
            segment?: string;
            subject?: string;
        } = body;

        if (!contactIds || contactIds.length === 0) {
            return NextResponse.json({ error: 'No contacts selected' }, { status: 400 });
        }
        if (!message || message.trim().length === 0) {
            return NextResponse.json({ error: 'Message is required' }, { status: 400 });
        }
        if (!locationKey) {
            return NextResponse.json({ error: 'Location is required' }, { status: 400 });
        }

        // Email cap: max 50 per run
        const MAX_EMAIL_PER_RUN = 50;
        let effectiveContactIds = contactIds;
        let emailCapped = false;
        if (channel === 'email' && contactIds.length > MAX_EMAIL_PER_RUN) {
            effectiveContactIds = contactIds.slice(0, MAX_EMAIL_PER_RUN);
            emailCapped = true;
        }
        if (channel === 'sms' && contactIds.length > 200) {
            return NextResponse.json({ error: 'Maximum 200 contacts per SMS campaign' }, { status: 400 });
        }

        const selectedContacts = contactsData.filter(c => effectiveContactIds.includes(c.contactId));

        console.log(`[ghl-reactivation] POST: channel=${channel}, location=${locationKey}, segment=${segment}, contactIds=${effectiveContactIds.length}, matched=${selectedContacts.length}`);

        if (selectedContacts.length === 0) {
            return NextResponse.json({
                error: `No contacts matched. Sent ${effectiveContactIds.length} IDs but none found in contacts payload.`,
                sent: 0, failed: 0, skipped: 0, results: [],
            }, { status: 400 });
        }

        let result;
        if (channel === 'email') {
            result = await sendBulkEmail(
                locationKey,
                selectedContacts.map(c => ({
                    ...c,
                    email: c.email || '',
                })),
                message,
                LOCATION_NAMES[locationKey] || 'Chin Up!',
                subject || 'Chin Up! Aesthetics',
            );
        } else {
            result = await sendBulkSMS(
                locationKey,
                selectedContacts,
                message,
                LOCATION_NAMES[locationKey] || 'Chin Up!',
            );
        }

        console.log(`[ghl-reactivation] Result: sent=${result.sent}, failed=${result.failed}, skipped=${result.skipped}`);
        if (result.results?.some((r: { success: boolean; error?: string }) => !r.success)) {
            const errors = result.results.filter((r: { success: boolean; error?: string }) => !r.success).map((r: { contactId: string; error?: string }) => `${r.contactId}: ${r.error}`);
            console.warn(`[ghl-reactivation] Failed messages:`, errors.slice(0, 5));
        }

        // ── Record Campaign History (HIPAA-safe) ──
        const segmentLabel = segment ? (SMS_TEMPLATES[segment]?.label || segment) : 'unknown';
        try {
            const runResult = await sql`
                INSERT INTO campaign_runs (segment, segment_label, channel, location_key, total_targeted, total_sent, total_failed, total_skipped, message_template_key, run_by)
                VALUES (${segment || 'unknown'}, ${segmentLabel}, ${channel}, ${locationKey}, ${selectedContacts.length}, ${result.sent}, ${result.failed}, ${result.skipped}, ${segment || 'custom'}, ${session.user.email})
                RETURNING run_id
            `;
            const runId = runResult.rows[0]?.run_id;
            if (runId && result.results) {
                // Insert contact records with phone/email hashes (no PII)
                for (const r of result.results) {
                    const contact = selectedContacts.find(c => c.contactId === r.contactId);
                    const ph = contact?.phone ? hashPhone(contact.phone) : null;
                    const eh = contact?.email ? hashEmail(contact.email) : null;
                    await sql`
                        INSERT INTO campaign_contacts (run_id, contact_id, phone_hash, email_hash, location_key, channel, status, error_message)
                        VALUES (${runId}, ${r.contactId}, ${ph}, ${eh}, ${locationKey}, ${channel}, ${r.success ? 'sent' : 'failed'}, ${r.error?.slice(0, 200) || null})
                    `;
                }
            }
        } catch (err) {
            console.warn('[ghl-reactivation] Campaign history recording failed:', err);
            // Non-blocking — campaign was still sent
        }

        return NextResponse.json({
            ...result,
            channel,
            emailCapped,
            emailCapRemaining: emailCapped ? contactIds.length - MAX_EMAIL_PER_RUN : 0,
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
