/**
 * GHL v2 Conversations Intelligence
 * Fetches conversation history (SMS, calls, emails) via GoHighLevel v2 API
 * to provide engagement-based lead analysis, replacing timestamp-only stale detection.
 *
 * Base URL: https://services.leadconnectorhq.com
 * Auth: Private Integration Tokens (PITs) per location
 * Scopes: conversations.readonly, conversations/message.readonly
 * Rate Limits: 100 req/10s burst, 200K/day
 */

import { trackCall } from '@/lib/api-usage-tracker';
import {
    LocationKey, GHLOpportunity, getLocations, getStaleLeads, getFullPipelineData,
} from '@/lib/integrations/gohighlevel';
import { getClientMatchMaps, normalizePhone, type Client, getPurchasingClients, getAppointments, getClients, type StaffAppointment } from '@/lib/integrations/mindbody';

const GHL_V2_BASE = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = '2021-07-28';

// --- Types ---

export interface GHLConversation {
    id: string;
    contactId: string;
    locationId: string;
    lastMessageBody: string;
    lastMessageDate: number; // epoch ms
    lastMessageType: string; // TYPE_SMS, TYPE_CALL, TYPE_EMAIL
    lastMessageDirection: 'inbound' | 'outbound';
    unreadCount: number;
    type: string;
    fullName?: string;
    contactName?: string;
    email?: string;
    phone?: string;
    tags?: string[];
    dateAdded: number;
    dateUpdated: number;
}

export interface GHLMessage {
    id: string;
    conversationId: string;
    contactId: string;
    body: string;
    direction: 'inbound' | 'outbound';
    status: string;
    messageType: string; // TYPE_SMS, TYPE_CALL, TYPE_EMAIL
    dateAdded: string; // ISO
    userId?: string;
    callDuration?: number;
    callStatus?: string;
    from?: string;
    to?: string;
    source?: string;
    attachments?: { url: string; type: string }[];
}

export type LifecycleStage = 'untouched' | 'attempted' | 'engaged' | 'quoted' | 'ghost' | 'converted';

export interface ContactEngagement {
    contactId: string;
    contactName: string;
    phone: string;
    email: string;
    lastCommunicationDate: string | null;
    lastInboundDate: string | null;
    lastOutboundDate: string | null;
    firstOutboundDate: string | null;
    totalConversations: number;
    totalMessages: number;
    messageBreakdown: {
        sms: { inbound: number; outbound: number };
        call: { inbound: number; outbound: number; totalDurationSec: number };
        email: { inbound: number; outbound: number };
    };
    daysSinceLastContact: number | null;
    communicationGap: number | null; // days since last OUTBOUND
    hasRecentActivity: boolean; // activity within 14 days
    lifecycleStage: LifecycleStage;
    staffUserIds: string[]; // unique user IDs who handled messages
    isDND: boolean;
}

export interface MindbodyMatch {
    clientId: string;
    clientName: string;
    totalRevenue: number;
    lastSaleDate: string | null;
    daysSinceLastVisit: number | null;
    isActive: boolean; // had a purchase within last 90 days
}

export interface EngagementGap {
    opportunity: GHLOpportunity;
    engagement: ContactEngagement;
    daysSinceOutreach: number;
    monetaryValue: number;
    riskLevel: 'needs-outreach' | 'going-cold' | 'abandoned';
    suggestedAction: string;
    locationKey: LocationKey;
    locationName: string;
    pipelineName: string;
    stageName: string;
    achievabilityScore: number; // 0-100
    mindbodyMatch?: MindbodyMatch;
}

export interface LostRevenueCandidate {
    opportunity: GHLOpportunity;
    engagement: ContactEngagement;
    lastContactDate: string;
    daysSilent: number;
    monetaryValue: number;
    conversationCount: number;
    locationKey: LocationKey;
    locationName: string;
    pipelineName: string;
    stageName: string;
}

export interface SpeedToLeadMetric {
    contactId: string;
    contactName: string;
    leadCreatedAt: string;
    firstOutboundAt: string | null;
    responseTimeMinutes: number | null; // null = never responded
    locationKey: LocationKey;
    source: string;
}

export interface StaffMetric {
    userId: string;
    conversationsHandled: number;
    totalMessages: number;
    avgResponseTimeMinutes: number | null;
    locationKey: LocationKey;
}

export interface ConversationsIntelligence {
    engagementGaps: EngagementGap[];
    lostRevenueCandidates: LostRevenueCandidate[];
    staleLeadOverrides: { contactId: string; engagement: ContactEngagement }[];
    lifecycleCounts: Record<LifecycleStage, number>;
    _lifecycleByLocation?: Record<LocationKey, Record<LifecycleStage, number>>;
    speedToLead: {
        avgMinutes: Record<LocationKey, number | null>;
        neverResponded: number;
        metrics: SpeedToLeadMetric[];
    };
    staffMetrics: StaffMetric[];
    summary: {
        totalAnalyzed: number;
        withConversations: number;
        needsOutreach: number;
        goingCold: number;
        abandoned: number;
        falsePositives: number;
        lostRevenuePotential: number;
        dndFiltered: number;
        mindbodyActiveFiltered: number;
    };
    fetchedAt: string;
}

// --- Location Config (v2) ---

interface V2Location {
    key: LocationKey;
    name: string;
    locationId: string;
    pit: string;
}

function getV2Locations(): V2Location[] {
    const configs: { key: LocationKey; name: string; envId: string; envPit: string }[] = [
        { key: 'decatur', name: 'Decatur', envId: 'GHL_LOCATION_ID_DECATUR', envPit: 'GHL_PIT_DECATUR' },
        { key: 'smyrna', name: 'Smyrna/Vinings', envId: 'GHL_LOCATION_ID_SMYRNA', envPit: 'GHL_PIT_SMYRNA' },
        { key: 'kennesaw', name: 'Kennesaw', envId: 'GHL_LOCATION_ID_KENNESAW', envPit: 'GHL_PIT_KENNESAW' },
    ];
    const locations: V2Location[] = [];
    for (const c of configs) {
        const locationId = process.env[c.envId];
        const pit = process.env[c.envPit];
        if (locationId && pit) {
            locations.push({ key: c.key, name: c.name, locationId, pit });
        }
    }
    return locations;
}

// --- v2 API Fetcher ---

async function ghlV2Fetch<T>(
    pit: string,
    endpoint: string,
    params?: Record<string, string>,
    retries: number = 3,
): Promise<T> {
    let url = `${GHL_V2_BASE}${endpoint}`;
    if (params) {
        const search = new URLSearchParams(params);
        url += (url.includes('?') ? '&' : '?') + search.toString();
    }

    for (let attempt = 0; attempt <= retries; attempt++) {
        const res = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${pit}`,
                'Version': GHL_API_VERSION,
                'Accept': 'application/json',
            },
        });

        if (res.ok) return res.json();

        // Retry on 429 with exponential backoff
        if (res.status === 429 && attempt < retries) {
            const delay = Math.min(1000 * Math.pow(2, attempt), 8000); // 1s, 2s, 4s
            await new Promise(r => setTimeout(r, delay));
            continue;
        }

        const text = await res.text();
        throw new Error(`GHL v2 API error (${res.status}): ${text.slice(0, 200)}`);
    }

    throw new Error('GHL v2 API: max retries exceeded');
}

// --- Cache ---

interface CacheEntry<T> { data: T; timestamp: number }
const engagementCache = new Map<string, CacheEntry<ContactEngagement>>();
const intelligenceCache = new Map<string, CacheEntry<ConversationsIntelligence>>();
const ENGAGEMENT_CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const INTELLIGENCE_CACHE_TTL = 30 * 60 * 1000;

// --- Core Conversation Fetchers ---

export async function getConversationsByContact(
    locationId: string,
    pit: string,
    contactId: string,
): Promise<GHLConversation[]> {
    const data = await ghlV2Fetch<{ conversations: GHLConversation[] }>(
        pit,
        '/conversations/search',
        { locationId, contactId },
    );
    trackCall('ghl', 'getConversationsByContact', false);
    return data.conversations || [];
}

export async function getConversationMessages(
    pit: string,
    conversationId: string,
    limit: number = 50,
): Promise<GHLMessage[]> {
    const data = await ghlV2Fetch<{ messages: { messages: GHLMessage[] } }>(
        pit,
        `/conversations/${conversationId}/messages`,
        { limit: String(limit) },
    );
    trackCall('ghl', 'getConversationMessages', false);
    return data.messages?.messages || [];
}

// --- Engagement Computation ---

const PRICING_KEYWORDS = ['price', 'cost', 'how much', '$', 'treatment', 'special', 'offer', 'consultation', 'quote', 'fee'];

function detectLifecycleStage(
    totalOutbound: number,
    totalInbound: number,
    totalExchanges: number,
    daysSilent: number | null,
    oppStatus: string,
    mentionedPricing: boolean,
): LifecycleStage {
    if (oppStatus === 'won') return 'converted';
    if (totalOutbound === 0 && totalInbound === 0) return 'untouched';
    if (totalOutbound > 0 && totalInbound === 0) return 'attempted';
    if (totalExchanges >= 3 && daysSilent !== null && daysSilent >= 14) return 'ghost';
    if (mentionedPricing && totalInbound > 0 && totalOutbound > 0) return 'quoted';
    if (totalInbound > 0 && totalOutbound > 0) return 'engaged';
    return 'attempted';
}

export async function getContactEngagement(
    locationId: string,
    pit: string,
    contactId: string,
    oppStatus: string = 'open',
): Promise<ContactEngagement> {
    const now = Date.now();
    const cached = engagementCache.get(contactId);
    if (cached && (now - cached.timestamp) < ENGAGEMENT_CACHE_TTL) {
        return cached.data;
    }

    const conversations = await getConversationsByContact(locationId, pit, contactId);

    let lastCommunicationDate: string | null = null;
    let lastInboundDate: string | null = null;
    let lastOutboundDate: string | null = null;
    let firstOutboundDate: string | null = null;
    let totalMessages = 0;
    const breakdown = {
        sms: { inbound: 0, outbound: 0 },
        call: { inbound: 0, outbound: 0, totalDurationSec: 0 },
        email: { inbound: 0, outbound: 0 },
    };
    const staffUserIds = new Set<string>();
    let mentionedPricing = false;
    let contactName = '';
    let phone = '';
    let email = '';
    let isDND = false;
    const tags: string[] = [];

    // Get metadata from first conversation
    if (conversations.length > 0) {
        const first = conversations[0];
        contactName = first.contactName || first.fullName || '';
        phone = first.phone || '';
        email = first.email || '';
        if (first.tags) tags.push(...first.tags);
        isDND = tags.some(t => /dnd|do.not.disturb|opted.out/i.test(t));
    }

    // For each conversation, get messages (limit to most recent 30 per conv for efficiency)
    for (const conv of conversations) {
        let messages: GHLMessage[];
        try {
            messages = await getConversationMessages(pit, conv.id, 30);
        } catch {
            continue;
        }

        for (const msg of messages) {
            totalMessages++;
            const msgDate = msg.dateAdded;

            // Track latest dates
            if (!lastCommunicationDate || msgDate > lastCommunicationDate) lastCommunicationDate = msgDate;
            if (msg.direction === 'inbound' && (!lastInboundDate || msgDate > lastInboundDate)) lastInboundDate = msgDate;
            if (msg.direction === 'outbound') {
                if (!lastOutboundDate || msgDate > lastOutboundDate) lastOutboundDate = msgDate;
                if (!firstOutboundDate || msgDate < firstOutboundDate) firstOutboundDate = msgDate;
            }

            // Track staff
            if (msg.userId) staffUserIds.add(msg.userId);

            // Count by type
            const type = (msg.messageType || '').toUpperCase();
            const dir = msg.direction;
            if (type.includes('SMS')) {
                breakdown.sms[dir]++;
            } else if (type.includes('CALL')) {
                breakdown.call[dir]++;
                if (msg.callDuration) breakdown.call.totalDurationSec += msg.callDuration;
            } else if (type.includes('EMAIL')) {
                breakdown.email[dir]++;
            }

            // Check for pricing keywords in outbound messages
            if (dir === 'outbound' && msg.body) {
                const bodyLower = msg.body.toLowerCase();
                if (PRICING_KEYWORDS.some(kw => bodyLower.includes(kw))) {
                    mentionedPricing = true;
                }
            }
        }
    }

    const MS_PER_DAY = 86400000;
    const daysSinceLastContact = lastCommunicationDate
        ? Math.floor((now - new Date(lastCommunicationDate).getTime()) / MS_PER_DAY)
        : null;
    const communicationGap = lastOutboundDate
        ? Math.floor((now - new Date(lastOutboundDate).getTime()) / MS_PER_DAY)
        : null;

    const totalOutbound = breakdown.sms.outbound + breakdown.call.outbound + breakdown.email.outbound;
    const totalInbound = breakdown.sms.inbound + breakdown.call.inbound + breakdown.email.inbound;

    const engagement: ContactEngagement = {
        contactId,
        contactName,
        phone,
        email,
        lastCommunicationDate,
        lastInboundDate,
        lastOutboundDate,
        firstOutboundDate,
        totalConversations: conversations.length,
        totalMessages,
        messageBreakdown: breakdown,
        daysSinceLastContact,
        communicationGap,
        hasRecentActivity: daysSinceLastContact !== null && daysSinceLastContact < 14,
        lifecycleStage: detectLifecycleStage(
            totalOutbound, totalInbound, totalMessages, daysSinceLastContact, oppStatus, mentionedPricing
        ),
        staffUserIds: Array.from(staffUserIds),
        isDND,
    };

    engagementCache.set(contactId, { data: engagement, timestamp: now });
    return engagement;
}

// --- Batch Engagement ---

async function batchAsync<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
    for (let i = 0; i < items.length; i += concurrency) {
        await Promise.all(items.slice(i, i + concurrency).map(fn));
        // 300ms pause between batches to respect GHL rate limits (100 req/10s)
        if (i + concurrency < items.length) {
            await new Promise(r => setTimeout(r, 300));
        }
    }
}

export async function batchGetEngagement(
    locationId: string,
    pit: string,
    contactIds: string[],
    oppStatusMap: Map<string, string> = new Map(),
    concurrency: number = 5,
): Promise<Map<string, ContactEngagement>> {
    const results = new Map<string, ContactEngagement>();

    await batchAsync(contactIds, concurrency, async (contactId) => {
        try {
            const engagement = await getContactEngagement(
                locationId, pit, contactId, oppStatusMap.get(contactId) || 'open'
            );
            results.set(contactId, engagement);
        } catch (err) {
            console.warn(`[ghl-conversations] Failed to get engagement for ${contactId}:`, err);
        }
    });

    return results;
}

// --- Suggested Actions ---

function generateSuggestedAction(engagement: ContactEngagement): string {
    const { messageBreakdown: mb, communicationGap, lifecycleStage, totalMessages } = engagement;
    const totalCalls = mb.call.inbound + mb.call.outbound;
    const totalSMS = mb.sms.inbound + mb.sms.outbound;

    if (lifecycleStage === 'untouched') {
        return 'No outreach attempted yet. Send an intro text or call immediately.';
    }
    if (lifecycleStage === 'attempted' && totalSMS > 0 && totalCalls === 0) {
        return `Sent ${mb.sms.outbound} text(s) with no reply. Try calling instead.`;
    }
    if (lifecycleStage === 'attempted' && totalCalls > 0) {
        return `Called ${mb.call.outbound}x with no answer. Try a different time or send a text.`;
    }
    if (lifecycleStage === 'ghost') {
        const callMin = Math.round(mb.call.totalDurationSec / 60);
        if (totalCalls > 0) {
            return `Had ${totalCalls} call(s) (${callMin} min total), then went silent ${communicationGap}d ago. Send a personal follow-up text.`;
        }
        return `Exchanged ${totalMessages} messages, then went silent ${communicationGap}d ago. Send a re-engagement text.`;
    }
    if (lifecycleStage === 'quoted') {
        return `Discussed pricing/services. Follow up with a special offer or consultation invite.`;
    }
    if (communicationGap && communicationGap >= 14) {
        return `No outreach in ${communicationGap} days. Send a check-in text.`;
    }

    return 'Review conversation history and follow up.';
}

// --- Achievability Score ---

function computeAchievabilityScore(
    engagement: ContactEngagement,
    monetaryValue: number,
    maxValue: number,
): number {
    let score = 0;
    const { daysSinceLastContact, totalMessages, lifecycleStage } = engagement;

    // Recency (40%)
    if (daysSinceLastContact === null) score += 0;
    else if (daysSinceLastContact < 7) score += 40;
    else if (daysSinceLastContact < 14) score += 32;
    else if (daysSinceLastContact < 30) score += 20;
    else if (daysSinceLastContact < 60) score += 10;
    else score += 4;

    // Conversation depth (20%)
    if (totalMessages >= 10) score += 20;
    else if (totalMessages >= 5) score += 15;
    else if (totalMessages >= 2) score += 10;
    else if (totalMessages >= 1) score += 5;

    // Monetary value (20%)
    if (maxValue > 0) score += Math.round((monetaryValue / maxValue) * 20);

    // Lifecycle (20%)
    const stageScores: Record<LifecycleStage, number> = {
        quoted: 20, engaged: 16, ghost: 12, attempted: 8, untouched: 4, converted: 0,
    };
    score += stageScores[lifecycleStage] || 0;

    return Math.min(100, Math.max(0, score));
}

// --- Location Filter Helper ---

function filterIntelligenceByLocation(
    data: ConversationsIntelligence,
    locationKey: LocationKey,
): ConversationsIntelligence {
    const filteredGaps = data.engagementGaps.filter(g => g.locationKey === locationKey);
    const filteredLost = data.lostRevenueCandidates.filter(c => c.locationKey === locationKey);
    const filteredSpeedMetrics = data.speedToLead.metrics.filter(m => m.locationKey === locationKey);
    const filteredStaff = data.staffMetrics.filter(s => s.locationKey === locationKey);

    // Recompute speed-to-lead averages for this location only
    const avgMinutes: Record<LocationKey, number | null> = { decatur: null, smyrna: null, kennesaw: null };
    avgMinutes[locationKey] = data.speedToLead.avgMinutes[locationKey];

    const locationLC = data._lifecycleByLocation?.[locationKey]
        || { untouched: 0, attempted: 0, engaged: 0, quoted: 0, ghost: 0, converted: 0 };
    const locationTotal = Object.values(locationLC).reduce((s, n) => s + n, 0);

    return {
        engagementGaps: filteredGaps,
        lostRevenueCandidates: filteredLost,
        staleLeadOverrides: data.staleLeadOverrides, // aggregate
        lifecycleCounts: locationLC,
        speedToLead: {
            avgMinutes,
            neverResponded: filteredSpeedMetrics.filter(m => m.responseTimeMinutes === null).length,
            metrics: filteredSpeedMetrics,
        },
        staffMetrics: filteredStaff,
        summary: {
            totalAnalyzed: locationTotal,
            withConversations: filteredGaps.filter(g => g.engagement.totalConversations > 0).length,
            needsOutreach: filteredGaps.filter(g => g.riskLevel === 'needs-outreach').length,
            goingCold: filteredGaps.filter(g => g.riskLevel === 'going-cold').length,
            abandoned: filteredGaps.filter(g => g.riskLevel === 'abandoned').length,
            falsePositives: data.summary.falsePositives, // aggregate
            lostRevenuePotential: filteredLost.reduce((sum, c) => sum + c.monetaryValue, 0),
            dndFiltered: data.summary.dndFiltered, // aggregate
            mindbodyActiveFiltered: data.summary.mindbodyActiveFiltered, // aggregate
        },
        fetchedAt: data.fetchedAt,
    };
}

// --- Master Intelligence Function ---

export async function getConversationsIntelligence(
    options?: { locationFilter?: LocationKey; forceRefresh?: boolean },
): Promise<ConversationsIntelligence> {
    const cacheKey = options?.locationFilter || 'all';
    const now = Date.now();

    if (!options?.forceRefresh) {
        const cached = intelligenceCache.get(cacheKey);
        if (cached && (now - cached.timestamp) < INTELLIGENCE_CACHE_TTL) {
            return cached.data;
        }

        // If requesting a specific location, derive from cached 'all' data to avoid redundant API calls
        if (options?.locationFilter) {
            const allCached = intelligenceCache.get('all');
            if (allCached && (now - allCached.timestamp) < INTELLIGENCE_CACHE_TTL) {
                const filtered = filterIntelligenceByLocation(allCached.data, options.locationFilter);
                intelligenceCache.set(cacheKey, { data: filtered, timestamp: allCached.timestamp });
                return filtered;
            }
        }
    }

    const v2Locations = getV2Locations();
    if (v2Locations.length === 0) {
        throw new Error('GHL v2 not configured — add PIT tokens');
    }

    // 1. Get existing stale leads + pipeline data + MindBody match maps
    // MindBody: look back 12 months to capture all recent purchasing clients
    const mbStartDate = new Date(Date.now() - 365 * 86400000).toISOString().split('T')[0];
    const mbEndDate = new Date().toISOString().split('T')[0];

    let mbEmailMap: Map<string, { client: Client; revenue: number }> | null = null;
    let mbPhoneMap: Map<string, { client: Client; revenue: number }> | null = null;
    let mbNameMap: Map<string, { client: Client; revenue: number }> | null = null;
    let mbSalesByClient: Map<string, string> | null = null; // clientId → last sale date

    const [staleLeads, pipelineData] = await Promise.all([
        getStaleLeads(options?.locationFilter),
        getFullPipelineData({ locationFilter: options?.locationFilter }),
    ]);

    // Fetch MindBody data (non-blocking — if it fails, we just skip the cross-reference)
    try {
        const [matchMaps, mbData] = await Promise.all([
            getClientMatchMaps(mbStartDate, mbEndDate),
            getPurchasingClients(mbStartDate, mbEndDate),
        ]);
        mbEmailMap = matchMaps.emailMap;
        mbPhoneMap = matchMaps.phoneMap;
        mbNameMap = matchMaps.nameMap;
        // Build last sale date per client
        mbSalesByClient = new Map();
        for (const sale of mbData.sales) {
            const existing = mbSalesByClient.get(sale.ClientId);
            const saleDate = sale.SaleDate || sale.SaleDateTime;
            if (!existing || saleDate > existing) {
                mbSalesByClient.set(sale.ClientId, saleDate);
            }
        }
    } catch (err) {
        console.warn('[ghl-conversations] MindBody cross-reference unavailable:', err);
    }

    // 2. Collect all contactIds to analyze (stale leads + open opps with value)
    const contactMap = new Map<string, {
        opp: GHLOpportunity;
        locationKey: LocationKey;
        locationName: string;
        pipelineName: string;
        stageName: string;
    }>();

    // Add stale leads
    for (const sl of staleLeads) {
        if (sl.opportunity.contactId) {
            contactMap.set(sl.opportunity.contactId, {
                opp: sl.opportunity,
                locationKey: sl.locationKey,
                locationName: sl.locationName,
                pipelineName: sl.pipelineName,
                stageName: sl.stageName,
            });
        }
    }

    // Add open opportunities with monetary value
    for (const locSummary of pipelineData.locations) {
        for (const pipeline of locSummary.pipelines) {
            for (const stage of pipeline.stages) {
                for (const opp of stage.opportunities) {
                    if (opp.contactId && opp.monetaryValue > 0 && !contactMap.has(opp.contactId)) {
                        contactMap.set(opp.contactId, {
                            opp,
                            locationKey: locSummary.location,
                            locationName: locSummary.locationName,
                            pipelineName: pipeline.name,
                            stageName: stage.name,
                        });
                    }
                }
            }
        }
    }

    // Cap contacts to avoid rate-limit issues (100 req/10s = ~600/min)
    // Each contact = 1 search + ~1-3 message fetches = ~2-4 API calls
    // Cap at 150 contacts = ~450 API calls, safe within rate limits
    const MAX_CONTACTS = 150;
    if (contactMap.size > MAX_CONTACTS) {
        // Prioritize by monetary value (highest first)
        const sorted = Array.from(contactMap.entries())
            .sort((a, b) => b[1].opp.monetaryValue - a[1].opp.monetaryValue);
        const keep = new Set(sorted.slice(0, MAX_CONTACTS).map(([id]) => id));
        for (const [id] of contactMap) {
            if (!keep.has(id)) contactMap.delete(id);
        }
    }

    console.log(`[ghl-conversations] Analyzing ${contactMap.size} contacts across ${v2Locations.length} locations`);

    // 3. Batch-fetch engagement per location
    const v2ByKey = new Map<LocationKey, V2Location>();
    for (const loc of v2Locations) v2ByKey.set(loc.key, loc);

    // Group contacts by location
    const contactsByLocation = new Map<LocationKey, string[]>();
    const oppStatusMap = new Map<string, string>();
    for (const [contactId, info] of contactMap) {
        const list = contactsByLocation.get(info.locationKey) || [];
        list.push(contactId);
        contactsByLocation.set(info.locationKey, list);
        oppStatusMap.set(contactId, info.opp.status);
    }

    // De-duplicate by phone (track which contactId we've already analyzed)
    const seenPhones = new Set<string>();
    const allEngagement = new Map<string, ContactEngagement>();

    for (const [locationKey, contactIds] of contactsByLocation) {
        const loc = v2ByKey.get(locationKey);
        if (!loc) continue;

        const engMap = await batchGetEngagement(loc.locationId, loc.pit, contactIds, oppStatusMap);
        for (const [cid, eng] of engMap) {
            // De-duplicate by phone
            const normalizedPhone = eng.phone?.replace(/\D/g, '') || '';
            if (normalizedPhone && seenPhones.has(normalizedPhone)) continue;
            if (normalizedPhone) seenPhones.add(normalizedPhone);

            allEngagement.set(cid, eng);
        }
    }

    // 4. Compute engagement gaps

    // Helper: match a GHL contact against MindBody by email/phone
    function findMindbodyMatch(engagement: ContactEngagement): MindbodyMatch | undefined {
        if (!mbEmailMap && !mbPhoneMap && !mbNameMap) return undefined;

        let match: { client: Client; revenue: number } | undefined;

        // Try email first
        if (engagement.email && mbEmailMap) {
            const emailKey = engagement.email.toLowerCase().trim();
            if (emailKey) match = mbEmailMap.get(emailKey);
        }

        // Fall back to phone
        if (!match && engagement.phone && mbPhoneMap) {
            const phoneKey = normalizePhone(engagement.phone);
            if (phoneKey.length === 10) match = mbPhoneMap.get(phoneKey);
        }

        // Fall back to name (only unique names — collisions are excluded)
        if (!match && engagement.contactName && mbNameMap) {
            const nameKey = engagement.contactName.toLowerCase().trim();
            if (nameKey && nameKey !== 'unknown') {
                match = mbNameMap.get(nameKey);
            }
        }

        if (!match) return undefined;

        const lastSaleDate = mbSalesByClient?.get(match.client.Id) || null;
        const daysSinceLastVisit = lastSaleDate
            ? Math.floor((Date.now() - new Date(lastSaleDate).getTime()) / 86400000)
            : null;

        return {
            clientId: match.client.Id,
            clientName: `${match.client.FirstName} ${match.client.LastName}`.trim(),
            totalRevenue: match.revenue,
            lastSaleDate,
            daysSinceLastVisit,
            isActive: daysSinceLastVisit !== null && daysSinceLastVisit <= 120,
        };
    }

    const engagementGaps: EngagementGap[] = [];
    const lostRevenueCandidates: LostRevenueCandidate[] = [];
    const staleLeadOverrides: { contactId: string; engagement: ContactEngagement }[] = [];
    const lifecycleCounts: Record<LifecycleStage, number> = {
        untouched: 0, attempted: 0, engaged: 0, quoted: 0, ghost: 0, converted: 0,
    };
    const emptyLC = () => ({ untouched: 0, attempted: 0, engaged: 0, quoted: 0, ghost: 0, converted: 0 });
    const lifecycleByLocation: Record<LocationKey, Record<LifecycleStage, number>> = {
        decatur: emptyLC(), smyrna: emptyLC(), kennesaw: emptyLC(),
    };
    const speedToLeadMetrics: SpeedToLeadMetric[] = [];
    const staffCounts = new Map<string, { conversations: number; messages: number; locationKey: LocationKey }>();
    let falsePositives = 0;
    let dndFiltered = 0;
    let mindbodyActiveFiltered = 0;

    const maxValue = Math.max(...Array.from(contactMap.values()).map(c => c.opp.monetaryValue), 1);

    for (const [contactId, info] of contactMap) {
        const engagement = allEngagement.get(contactId);
        if (!engagement) continue;

        // Count lifecycle stages
        lifecycleCounts[engagement.lifecycleStage]++;
        if (lifecycleByLocation[info.locationKey]) {
            lifecycleByLocation[info.locationKey][engagement.lifecycleStage]++;
        }

        // Track DND
        if (engagement.isDND) {
            dndFiltered++;
            continue; // Skip DND contacts from gap/lost analysis
        }

        // Track staff metrics
        for (const userId of engagement.staffUserIds) {
            const existing = staffCounts.get(`${userId}_${info.locationKey}`) || {
                conversations: 0, messages: 0, locationKey: info.locationKey,
            };
            existing.conversations++;
            existing.messages += engagement.totalMessages;
            staffCounts.set(`${userId}_${info.locationKey}`, existing);
        }

        // Speed-to-lead
        if (engagement.firstOutboundDate) {
            const leadCreatedMs = new Date(info.opp.createdAt).getTime();
            const firstOutMs = new Date(engagement.firstOutboundDate).getTime();
            const responseTimeMin = Math.max(0, Math.round((firstOutMs - leadCreatedMs) / 60000));
            speedToLeadMetrics.push({
                contactId,
                contactName: engagement.contactName,
                leadCreatedAt: info.opp.createdAt,
                firstOutboundAt: engagement.firstOutboundDate,
                responseTimeMinutes: responseTimeMin,
                locationKey: info.locationKey,
                source: info.opp.source,
            });
        } else if (engagement.lifecycleStage === 'untouched') {
            speedToLeadMetrics.push({
                contactId,
                contactName: engagement.contactName,
                leadCreatedAt: info.opp.createdAt,
                firstOutboundAt: null,
                responseTimeMinutes: null,
                locationKey: info.locationKey,
                source: info.opp.source,
            });
        }

        // Check if stale lead is actually a false positive
        const isStale = staleLeads.some(sl => sl.opportunity.contactId === contactId);
        if (isStale && engagement.hasRecentActivity) {
            falsePositives++;
            staleLeadOverrides.push({ contactId, engagement });
        }

        // MindBody cross-reference
        const mbMatch = findMindbodyMatch(engagement);

        // Active MB patient (purchased within 120 days) — skip engagement gaps AND lost revenue
        if (mbMatch?.isActive) {
            mindbodyActiveFiltered++;
            continue;
        }

        // Engagement gaps (needs outreach)
        const gap = engagement.communicationGap;
        if (gap !== null && gap >= 7 && info.opp.monetaryValue > 0) {
            let riskLevel: 'needs-outreach' | 'going-cold' | 'abandoned';
            if (gap >= 30) riskLevel = 'abandoned';
            else if (gap >= 14) riskLevel = 'going-cold';
            else riskLevel = 'needs-outreach';

            engagementGaps.push({
                opportunity: info.opp,
                engagement,
                daysSinceOutreach: gap,
                monetaryValue: info.opp.monetaryValue,
                riskLevel,
                suggestedAction: generateSuggestedAction(engagement),
                locationKey: info.locationKey,
                locationName: info.locationName,
                pipelineName: info.pipelineName,
                stageName: info.stageName,
                achievabilityScore: computeAchievabilityScore(engagement, info.opp.monetaryValue, maxValue),
                mindbodyMatch: mbMatch,
            });
        }

        // Lost revenue candidates (were engaged, then went dark)
        if (
            (engagement.lifecycleStage === 'ghost' || engagement.lifecycleStage === 'quoted') &&
            engagement.daysSinceLastContact !== null &&
            engagement.daysSinceLastContact >= 14 &&
            info.opp.monetaryValue > 0
        ) {
            lostRevenueCandidates.push({
                opportunity: info.opp,
                engagement,
                lastContactDate: engagement.lastCommunicationDate!,
                daysSilent: engagement.daysSinceLastContact,
                monetaryValue: info.opp.monetaryValue,
                conversationCount: engagement.totalConversations,
                locationKey: info.locationKey,
                locationName: info.locationName,
                pipelineName: info.pipelineName,
                stageName: info.stageName,
            });
        }
    }

    // Sort engagement gaps by value (highest first), then by achievability
    engagementGaps.sort((a, b) => b.achievabilityScore - a.achievabilityScore || b.monetaryValue - a.monetaryValue);
    lostRevenueCandidates.sort((a, b) => b.monetaryValue - a.monetaryValue);

    // Compute speed-to-lead averages per location
    const speedByLocation = new Map<LocationKey, number[]>();
    let neverResponded = 0;
    for (const s of speedToLeadMetrics) {
        if (s.responseTimeMinutes === null) {
            neverResponded++;
        } else {
            const list = speedByLocation.get(s.locationKey) || [];
            list.push(s.responseTimeMinutes);
            speedByLocation.set(s.locationKey, list);
        }
    }
    const avgSpeedByLocation: Record<LocationKey, number | null> = { decatur: null, smyrna: null, kennesaw: null };
    for (const [key, times] of speedByLocation) {
        avgSpeedByLocation[key] = times.length > 0 ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null;
    }

    // Build staff metrics
    const staffMetrics: StaffMetric[] = Array.from(staffCounts.entries()).map(([key, data]) => {
        const userId = key.split('_')[0];
        return {
            userId,
            conversationsHandled: data.conversations,
            totalMessages: data.messages,
            avgResponseTimeMinutes: null, // Would need per-message analysis for accurate response times
            locationKey: data.locationKey,
        };
    });

    const intelligence: ConversationsIntelligence = {
        engagementGaps: engagementGaps.slice(0, 50),
        lostRevenueCandidates: lostRevenueCandidates.slice(0, 30),
        staleLeadOverrides,
        lifecycleCounts,
        _lifecycleByLocation: lifecycleByLocation,
        speedToLead: {
            avgMinutes: avgSpeedByLocation,
            neverResponded,
            metrics: speedToLeadMetrics.slice(0, 100),
        },
        staffMetrics,
        summary: {
            totalAnalyzed: allEngagement.size,
            withConversations: Array.from(allEngagement.values()).filter(e => e.totalConversations > 0).length,
            needsOutreach: engagementGaps.filter(g => g.riskLevel === 'needs-outreach').length,
            goingCold: engagementGaps.filter(g => g.riskLevel === 'going-cold').length,
            abandoned: engagementGaps.filter(g => g.riskLevel === 'abandoned').length,
            falsePositives,
            lostRevenuePotential: lostRevenueCandidates.reduce((sum, c) => sum + c.monetaryValue, 0),
            dndFiltered,
            mindbodyActiveFiltered,
        },
        fetchedAt: new Date().toISOString(),
    };

    intelligenceCache.set(cacheKey, { data: intelligence, timestamp: now });
    console.log(`[ghl-conversations] Analysis complete: ${intelligence.summary.totalAnalyzed} contacts, ${engagementGaps.length} gaps, ${lostRevenueCandidates.length} lost revenue candidates`);

    return intelligence;
}

// --- Pipeline Stage Recommendations ---

export interface StageRecommendation {
    contactId: string;
    contactName: string;
    opportunityId: string;
    currentStageId: string;
    currentStageName: string;
    recommendedStageId: string;
    recommendedStageName: string;
    reason: string;
    confidence: 'high' | 'medium' | 'low';
    locationKey: LocationKey;
    locationName: string;
    pipelineName: string;
    pipelineId: string;
    monetaryValue: number;
}

export async function computeStageRecommendations(
    locationFilter?: LocationKey,
): Promise<StageRecommendation[]> {
    const intelligence = await getConversationsIntelligence({ locationFilter });
    const pipelineData = await getFullPipelineData({ locationFilter });
    const recommendations: StageRecommendation[] = [];

    // Build stage lookup per pipeline
    const stagesByPipeline = new Map<string, Map<string, { id: string; name: string; position: number }>>();
    for (const loc of pipelineData.locations) {
        for (const pipeline of loc.pipelines) {
            const stageMap = new Map<string, { id: string; name: string; position: number }>();
            for (const stage of pipeline.stages) {
                stageMap.set(stage.name.toLowerCase(), stage);
            }
            stagesByPipeline.set(pipeline.id, stageMap);
        }
    }

    // Helper: find stage by keyword
    function findStage(pipelineId: string, ...keywords: string[]): { id: string; name: string } | null {
        const stages = stagesByPipeline.get(pipelineId);
        if (!stages) return null;
        for (const kw of keywords) {
            for (const [key, stage] of stages) {
                if (key.includes(kw)) return stage;
            }
        }
        return null;
    }

    // Analyze engagement gaps to produce recommendations
    for (const gap of intelligence.engagementGaps) {
        const eng = gap.engagement;
        const opp = gap.opportunity;
        const stages = stagesByPipeline.get(opp.pipelineId);
        if (!stages) continue;

        const currentStageName = gap.stageName.toLowerCase();
        const totalCalls = eng.messageBreakdown.call.inbound + eng.messageBreakdown.call.outbound;
        const totalOutbound = eng.messageBreakdown.sms.outbound + eng.messageBreakdown.call.outbound + eng.messageBreakdown.email.outbound;

        // Rule: "New Lead" with 3+ completed calls → "Engaged Lead"
        if (currentStageName.includes('new lead') && totalCalls >= 3 && eng.lifecycleStage === 'engaged') {
            const target = findStage(opp.pipelineId, 'engaged', 'warm');
            if (target && target.id !== opp.pipelineStageId) {
                recommendations.push({
                    contactId: opp.contactId,
                    contactName: opp.contactName,
                    opportunityId: opp.id,
                    currentStageId: opp.pipelineStageId,
                    currentStageName: gap.stageName,
                    recommendedStageId: target.id,
                    recommendedStageName: target.name,
                    reason: `${totalCalls} calls completed, two-way conversation established`,
                    confidence: 'high',
                    locationKey: gap.locationKey,
                    locationName: gap.locationName,
                    pipelineName: gap.pipelineName,
                    pipelineId: opp.pipelineId,
                    monetaryValue: opp.monetaryValue,
                });
                continue;
            }
        }

        // Rule: "Called 1x" or "Called 2x" with 3+ unanswered outbound → "Stale Lead" or "No Response"
        if ((currentStageName.includes('called') || currentStageName.includes('call')) && totalOutbound >= 3 && eng.lifecycleStage === 'attempted') {
            const target = findStage(opp.pipelineId, 'stale', 'no response', 'cold');
            if (target && target.id !== opp.pipelineStageId) {
                recommendations.push({
                    contactId: opp.contactId,
                    contactName: opp.contactName,
                    opportunityId: opp.id,
                    currentStageId: opp.pipelineStageId,
                    currentStageName: gap.stageName,
                    recommendedStageId: target.id,
                    recommendedStageName: target.name,
                    reason: `${totalOutbound} outbound attempts with no response`,
                    confidence: 'high',
                    locationKey: gap.locationKey,
                    locationName: gap.locationName,
                    pipelineName: gap.pipelineName,
                    pipelineId: opp.pipelineId,
                    monetaryValue: opp.monetaryValue,
                });
                continue;
            }
        }

        // Rule: "Engaged Lead" with 60+ days silence → "Lost/Dormant"
        if (currentStageName.includes('engaged') && eng.daysSinceLastContact !== null && eng.daysSinceLastContact >= 60) {
            const target = findStage(opp.pipelineId, 'stale', 'dormant', 'cold', 'lost');
            if (target && target.id !== opp.pipelineStageId) {
                recommendations.push({
                    contactId: opp.contactId,
                    contactName: opp.contactName,
                    opportunityId: opp.id,
                    currentStageId: opp.pipelineStageId,
                    currentStageName: gap.stageName,
                    recommendedStageId: target.id,
                    recommendedStageName: target.name,
                    reason: `${eng.daysSinceLastContact} days since last communication`,
                    confidence: 'medium',
                    locationKey: gap.locationKey,
                    locationName: gap.locationName,
                    pipelineName: gap.pipelineName,
                    pipelineId: opp.pipelineId,
                    monetaryValue: opp.monetaryValue,
                });
                continue;
            }
        }

        // Rule: Any stage with ghost lifecycle → recommend "Stale" or "Follow Up"
        if (eng.lifecycleStage === 'ghost' && !currentStageName.includes('stale') && !currentStageName.includes('cold') && !currentStageName.includes('dormant')) {
            const target = findStage(opp.pipelineId, 'stale', 'follow up', 'cold');
            if (target && target.id !== opp.pipelineStageId) {
                recommendations.push({
                    contactId: opp.contactId,
                    contactName: opp.contactName,
                    opportunityId: opp.id,
                    currentStageId: opp.pipelineStageId,
                    currentStageName: gap.stageName,
                    recommendedStageId: target.id,
                    recommendedStageName: target.name,
                    reason: `Was engaged (${eng.totalMessages} messages) but went silent ${eng.daysSinceLastContact}d ago`,
                    confidence: 'medium',
                    locationKey: gap.locationKey,
                    locationName: gap.locationName,
                    pipelineName: gap.pipelineName,
                    pipelineId: opp.pipelineId,
                    monetaryValue: opp.monetaryValue,
                });
            }
        }
    }

    // Sort by confidence (high first) then by value
    const confidenceOrder = { high: 0, medium: 1, low: 2 };
    recommendations.sort((a, b) =>
        confidenceOrder[a.confidence] - confidenceOrder[b.confidence] || b.monetaryValue - a.monetaryValue
    );

    return recommendations;
}

// --- Call Transcript ---

export interface TranscriptSegment {
    mediaChannel: number; // 1 = patient, 2 = staff
    sentenceIndex: number;
    startTime: string;
    endTime: string;
    transcript: string;
    confidence: string;
}

export async function getCallTranscript(
    locationId: string,
    pit: string,
    messageId: string,
): Promise<TranscriptSegment[]> {
    const data = await ghlV2Fetch<TranscriptSegment[]>(
        pit,
        `/conversations/locations/${locationId}/messages/${messageId}/transcription`,
    );
    trackCall('ghl', 'getCallTranscript', false);
    return data || [];
}

// --- Lapsed Patient Detection (MindBody → GHL) ---

export interface LapsedPatient {
    mbClientId: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    totalRevenue: number;
    lastSaleDate: string;
    daysSinceLastVisit: number;
    segment: 'recent-lapse' | 'lapsed' | 'long-lapsed'; // 60-89d, 90-179d, 180+d
    ghlContactId?: string;
    ghlContactName?: string;
    locationKey?: LocationKey;
}

const lapsedCache = new Map<string, CacheEntry<LapsedPatient[]>>();
const LAPSED_CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Find MindBody purchasing clients who haven't visited recently.
 * Cross-references with GHL contacts to enable SMS re-activation.
 * Uses existing MindBody cache (4-hour TTL) so costs 0 extra API calls most of the time.
 */
export async function getLapsedPatients(
    minDaysSinceVisit: number = 60,
    locationFilter?: LocationKey,
): Promise<LapsedPatient[]> {
    const cacheKey = `lapsed_${minDaysSinceVisit}_${locationFilter || 'all'}`;
    const cached = lapsedCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < LAPSED_CACHE_TTL) {
        return cached.data;
    }

    // Look back 18 months for purchasing clients
    const startDate = new Date(Date.now() - 548 * 86400000).toISOString().split('T')[0];
    const endDate = new Date().toISOString().split('T')[0];

    const { clients, sales } = await getPurchasingClients(startDate, endDate);

    // Build revenue + last sale date per client
    const clientStats = new Map<string, { revenue: number; lastSaleDate: string }>();
    for (const sale of sales) {
        const existing = clientStats.get(sale.ClientId);
        const total = sale.PurchasedItems?.reduce((s, i) => s + (i.TotalAmount || 0), 0) || 0;
        const saleDate = sale.SaleDate || sale.SaleDateTime;
        if (existing) {
            existing.revenue += total;
            if (saleDate > existing.lastSaleDate) existing.lastSaleDate = saleDate;
        } else {
            clientStats.set(sale.ClientId, { revenue: total, lastSaleDate: saleDate });
        }
    }

    const now = Date.now();
    const lapsed: LapsedPatient[] = [];

    for (const client of clients) {
        const stats = clientStats.get(client.Id);
        if (!stats) continue;

        const daysSince = Math.floor((now - new Date(stats.lastSaleDate).getTime()) / 86400000);
        if (daysSince < minDaysSinceVisit) continue;

        // Must have a phone number
        const phone = client.MobilePhone || client.HomePhone || '';
        if (!phone) continue;

        let segment: LapsedPatient['segment'];
        if (daysSince < 90) segment = 'recent-lapse';
        else if (daysSince < 180) segment = 'lapsed';
        else segment = 'long-lapsed';

        lapsed.push({
            mbClientId: client.Id,
            firstName: client.FirstName || '',
            lastName: client.LastName || '',
            email: client.Email || '',
            phone,
            totalRevenue: stats.revenue,
            lastSaleDate: stats.lastSaleDate,
            daysSinceLastVisit: daysSince,
            segment,
        });
    }

    // Cross-reference with GHL contacts via phone map (instant, no API calls)
    try {
        const phoneMap = await buildPhoneMap(locationFilter);
        for (const patient of lapsed) {
            if (patient.ghlContactId) continue;
            const normalized = normalizePhone(patient.phone);
            if (normalized.length < 10) continue;
            const match = phoneMap.get(normalized);
            if (match) {
                patient.ghlContactId = match.contactId;
                patient.ghlContactName = match.contactName;
                patient.locationKey = match.locationKey;
            }
        }
    } catch (err) {
        console.warn('[ghl-conversations] GHL contact cross-reference for lapsed patients failed:', err);
    }

    // Sort by revenue (highest value first)
    lapsed.sort((a, b) => b.totalRevenue - a.totalRevenue);

    lapsedCache.set(cacheKey, { data: lapsed, timestamp: now });
    console.log(`[ghl-conversations] Found ${lapsed.length} lapsed patients (${lapsed.filter(l => l.ghlContactId).length} matched to GHL)`);

    return lapsed;
}

// --- Phone Map Utility (shared by lapsed, cancelled, consult-only) ---

interface PhoneMapEntry {
    contactId: string;
    contactName: string;
    locationKey: LocationKey;
    tags: string[];
    dnd: boolean;
}

let phoneMapCache: { data: Map<string, PhoneMapEntry>; timestamp: number } | null = null;
const PHONE_MAP_CACHE_TTL = 30 * 60 * 1000; // 30 min (matches pipeline cache)

/**
 * Build a phone→contactId map from all pipeline opportunity data.
 * Uses already-cached getFullPipelineData() — zero additional API calls.
 */
export async function buildPhoneMap(locationFilter?: LocationKey): Promise<Map<string, PhoneMapEntry>> {
    if (phoneMapCache && (Date.now() - phoneMapCache.timestamp) < PHONE_MAP_CACHE_TTL) {
        if (!locationFilter) return phoneMapCache.data;
        // Filter cached map by location
        const filtered = new Map<string, PhoneMapEntry>();
        for (const [phone, entry] of phoneMapCache.data) {
            if (entry.locationKey === locationFilter) filtered.set(phone, entry);
        }
        return filtered;
    }

    const pipelineData = await getFullPipelineData();
    const phoneMap = new Map<string, PhoneMapEntry>();

    for (const loc of pipelineData.locations) {
        for (const pipeline of loc.pipelines) {
            for (const stage of pipeline.stages) {
                for (const opp of stage.opportunities) {
                    if (opp.contactPhone && opp.contactId) {
                        const normalized = normalizePhone(opp.contactPhone);
                        if (normalized.length >= 10 && !phoneMap.has(normalized)) {
                            phoneMap.set(normalized, {
                                contactId: opp.contactId,
                                contactName: opp.contactName,
                                locationKey: opp.locationKey,
                                tags: opp.contactTags || [],
                                dnd: opp.contactDND === true
                                    || (opp.contactTags || []).some(t => /dnd|do.not.disturb|opted.out|unsubscribe/i.test(t)),
                            });
                        }
                    }
                }
            }
        }
    }

    phoneMapCache = { data: phoneMap, timestamp: Date.now() };
    console.log(`[ghl-conversations] Built phone map: ${phoneMap.size} contacts`);

    if (locationFilter) {
        const filtered = new Map<string, PhoneMapEntry>();
        for (const [phone, entry] of phoneMap) {
            if (entry.locationKey === locationFilter) filtered.set(phone, entry);
        }
        return filtered;
    }
    return phoneMap;
}

// --- Cancelled / No-Show Appointment Detection (Campaign 1) ---

export interface CancelledAppointment {
    mbClientId: string;
    firstName: string;
    lastName: string;
    phone: string;
    serviceName: string;
    appointmentDate: string;
    status: string; // "Cancelled", "NoShow", etc.
    ghlContactId?: string;
    ghlContactName?: string;
    locationKey?: LocationKey;
}

const cancelledCache = new Map<string, CacheEntry<CancelledAppointment[]>>();

export async function getCancelledAppointments(
    locationFilter?: LocationKey,
): Promise<CancelledAppointment[]> {
    const cacheKey = `cancelled_${locationFilter || 'all'}`;
    const cached = cancelledCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < LAPSED_CACHE_TTL) {
        return cached.data;
    }

    const now = Date.now();
    const startDate = new Date(now - 90 * 86400000).toISOString().split('T')[0];
    const endDate = new Date().toISOString().split('T')[0];

    const appointments = await getAppointments(startDate, endDate);

    // Separate completed and cancelled/no-show appointments
    const completedByClient = new Set<string>();
    const cancelledAppts: StaffAppointment[] = [];

    for (const appt of appointments) {
        const status = (appt.Status || '').toLowerCase();
        if (status === 'completed' || status === 'confirmed' || status === 'arrived') {
            if (appt.ClientId) completedByClient.add(appt.ClientId);
        } else if (/cancel|no.?show|late.?cancel/i.test(status)) {
            cancelledAppts.push(appt);
        }
    }

    // Deduplicate by client (keep most recent cancelled appointment)
    // Exclude clients who have a completed appointment (they came back)
    const byClient = new Map<string, StaffAppointment>();
    for (const appt of cancelledAppts) {
        if (!appt.ClientId) continue;
        if (completedByClient.has(appt.ClientId)) continue; // They came back
        const existing = byClient.get(appt.ClientId);
        if (!existing || appt.StartDateTime > existing.StartDateTime) {
            byClient.set(appt.ClientId, appt);
        }
    }

    // Build result list
    const result: CancelledAppointment[] = [];
    for (const [clientId, appt] of byClient) {
        const phone = appt.Client?.FirstName ? '' : ''; // Client object may not have phone
        // We'll need to look up client phone from purchasing clients cache
        result.push({
            mbClientId: clientId,
            firstName: appt.Client?.FirstName || '',
            lastName: appt.Client?.LastName || '',
            phone: '', // Will be filled from purchasing clients
            serviceName: appt.SessionType?.Name || 'appointment',
            appointmentDate: appt.StartDateTime,
            status: appt.Status,
        });
    }

    // Get client phone numbers — try purchasing clients cache first, then fetch remaining
    try {
        const lookbackStart = new Date(now - 548 * 86400000).toISOString().split('T')[0];
        const { clients } = await getPurchasingClients(lookbackStart, endDate);
        const clientMap = new Map<string, Client>();
        for (const c of clients) clientMap.set(c.Id, c);

        for (const r of result) {
            const client = clientMap.get(r.mbClientId);
            if (client) {
                r.phone = client.MobilePhone || client.HomePhone || '';
                if (!r.firstName) r.firstName = client.FirstName || '';
                if (!r.lastName) r.lastName = client.LastName || '';
            }
        }
    } catch {
        // Purchasing clients might not be cached yet
    }

    // Fallback: fetch clients who still have no phone (cancelled-only clients who never purchased)
    const missingPhone = result.filter(r => !r.phone).map(r => r.mbClientId);
    if (missingPhone.length > 0) {
        try {
            const fetched = await getClients(missingPhone);
            const fetchedMap = new Map<string, Client>();
            for (const c of fetched) fetchedMap.set(c.Id, c);
            for (const r of result) {
                if (r.phone) continue;
                const client = fetchedMap.get(r.mbClientId);
                if (client) {
                    r.phone = client.MobilePhone || client.HomePhone || '';
                    if (!r.firstName) r.firstName = client.FirstName || '';
                    if (!r.lastName) r.lastName = client.LastName || '';
                }
            }
        } catch {
            // Client fetch failed — some will still have no phone
        }
    }

    // Filter: must have phone
    const withPhone = result.filter(r => r.phone);

    // Cross-reference to GHL via phone map
    try {
        const phoneMap = await buildPhoneMap(locationFilter);
        for (const r of withPhone) {
            const normalized = normalizePhone(r.phone);
            const match = phoneMap.get(normalized);
            if (match) {
                r.ghlContactId = match.contactId;
                r.ghlContactName = match.contactName;
                r.locationKey = match.locationKey;
            }
        }
    } catch {
        // Phone map failed
    }

    withPhone.sort((a, b) => b.appointmentDate.localeCompare(a.appointmentDate));
    cancelledCache.set(cacheKey, { data: withPhone, timestamp: now });
    console.log(`[ghl-conversations] Found ${withPhone.length} cancelled/no-show appointments (${withPhone.filter(c => c.ghlContactId).length} matched to GHL)`);

    return withPhone;
}

// --- Consultation-Only Detection (Campaign 3) ---

export interface ConsultOnlyPatient {
    mbClientId: string;
    firstName: string;
    lastName: string;
    phone: string;
    consultDate: string;
    consultService: string;
    ghlContactId?: string;
    ghlContactName?: string;
    locationKey?: LocationKey;
}

const consultCache = new Map<string, CacheEntry<ConsultOnlyPatient[]>>();

export async function getConsultOnlyPatients(
    locationFilter?: LocationKey,
): Promise<ConsultOnlyPatient[]> {
    const cacheKey = `consult_${locationFilter || 'all'}`;
    const cached = consultCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < LAPSED_CACHE_TTL) {
        return cached.data;
    }

    const now = Date.now();
    const startDate = new Date(now - 180 * 86400000).toISOString().split('T')[0];
    const endDate = new Date().toISOString().split('T')[0];

    // Get appointments and sales data
    const [appointments, purchasingData] = await Promise.all([
        getAppointments(startDate, endDate),
        getPurchasingClients(startDate, endDate),
    ]);

    // Find completed consultations
    const consultAppts: StaffAppointment[] = [];
    for (const appt of appointments) {
        const status = (appt.Status || '').toLowerCase();
        const sessionName = (appt.SessionType?.Name || '').toLowerCase();
        if ((status === 'completed' || status === 'confirmed' || status === 'arrived')
            && /consult/i.test(sessionName)) {
            consultAppts.push(appt);
        }
    }

    // Build a set of clients who made purchases AFTER their consultation
    const salesByClient = new Map<string, string[]>(); // clientId → sale dates
    for (const sale of purchasingData.sales) {
        if (!sale.ClientId) continue;
        const saleDate = sale.SaleDate || sale.SaleDateTime || '';
        if (!salesByClient.has(sale.ClientId)) salesByClient.set(sale.ClientId, []);
        salesByClient.get(sale.ClientId)!.push(saleDate);
    }

    // Deduplicate consults by client (keep most recent)
    const consultByClient = new Map<string, StaffAppointment>();
    for (const appt of consultAppts) {
        if (!appt.ClientId) continue;
        const existing = consultByClient.get(appt.ClientId);
        if (!existing || appt.StartDateTime > existing.StartDateTime) {
            consultByClient.set(appt.ClientId, appt);
        }
    }

    // Filter: clients who consulted but never purchased after
    const result: ConsultOnlyPatient[] = [];
    const clientMap = new Map<string, Client>();
    for (const c of purchasingData.clients) clientMap.set(c.Id, c);

    // Collect client IDs we need to fetch (not in purchasing clients)
    const needsFetch: string[] = [];
    for (const [clientId, appt] of consultByClient) {
        const clientSales = salesByClient.get(clientId) || [];
        const consultDate = appt.StartDateTime;
        const hasPurchaseAfter = clientSales.some(sd => sd > consultDate);
        if (hasPurchaseAfter) continue;
        if (!clientMap.has(clientId)) needsFetch.push(clientId);
    }

    // Fetch missing client records for phone numbers
    if (needsFetch.length > 0) {
        try {
            const fetched = await getClients(needsFetch);
            for (const c of fetched) clientMap.set(c.Id, c);
        } catch {
            // Some clients will be missing phone
        }
    }

    for (const [clientId, appt] of consultByClient) {
        const clientSales = salesByClient.get(clientId) || [];
        const consultDate = appt.StartDateTime;

        // Check if any sale happened AFTER the consultation
        const hasPurchaseAfter = clientSales.some(sd => sd > consultDate);
        if (hasPurchaseAfter) continue; // They converted — skip

        const client = clientMap.get(clientId);
        const phone = client?.MobilePhone || client?.HomePhone || '';
        if (!phone) continue;

        result.push({
            mbClientId: clientId,
            firstName: appt.Client?.FirstName || client?.FirstName || '',
            lastName: appt.Client?.LastName || client?.LastName || '',
            phone,
            consultDate: appt.StartDateTime,
            consultService: appt.SessionType?.Name || 'Consultation',
            ghlContactId: undefined,
            ghlContactName: undefined,
            locationKey: undefined,
        });
    }

    // Cross-reference to GHL via phone map
    try {
        const phoneMap = await buildPhoneMap(locationFilter);
        for (const r of result) {
            const normalized = normalizePhone(r.phone);
            const match = phoneMap.get(normalized);
            if (match) {
                r.ghlContactId = match.contactId;
                r.ghlContactName = match.contactName;
                r.locationKey = match.locationKey;
            }
        }
    } catch {
        // Phone map failed
    }

    result.sort((a, b) => b.consultDate.localeCompare(a.consultDate));
    consultCache.set(cacheKey, { data: result, timestamp: now });
    console.log(`[ghl-conversations] Found ${result.length} consult-only patients (${result.filter(c => c.ghlContactId).length} matched to GHL)`);

    return result;
}
