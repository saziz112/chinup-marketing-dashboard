/**
 * GoHighLevel API Client — Strategic Pipeline Analytics
 * Uses v1 REST API with Location JWT keys for auth.
 * Fetches pipeline data, opportunities, contacts, and conversations
 * across 3 Chin Up! Aesthetics locations (Decatur, Smyrna/Vinings, Kennesaw).
 *
 * Base URL: https://rest.gohighlevel.com/v1
 * Auth: Location API Keys (JWT) — Bearer token
 * Rate Limits: 100 req/10s burst, 200K/day
 *
 * Real Data Structure (discovered 2026-03-04):
 *   Decatur: 6 pipelines (Leads, Offers, 4 ad-specific), 5925 opps, 19849 contacts
 *   Smyrna/Vinings: 1 pipeline (Leads), 1593 opps, 4439 contacts
 *   Kennesaw: 1 pipeline (Leads), 2435 opps, 7493 contacts
 *   Source values: "fb-lead-form", "Website", "Facebook", etc.
 */

import { trackCall } from '@/lib/api-usage-tracker';

const GHL_BASE = 'https://rest.gohighlevel.com/v1';

// --- Types ---

export type LocationKey = 'decatur' | 'smyrna' | 'kennesaw';

export interface GHLLocation {
    key: LocationKey;
    name: string;
    locationId: string;
    apiKey: string;
}

export interface GHLPipeline {
    id: string;
    name: string;
    stages: GHLStage[];
    locationKey: LocationKey;
}

export interface GHLStage {
    id: string;
    name: string;
    position: number;
}

export interface GHLOpportunity {
    id: string;
    name: string;
    monetaryValue: number;
    pipelineId: string;
    pipelineStageId: string;
    status: string; // open, won, lost, abandoned
    source: string;
    contactId: string;
    contactName: string;
    contactEmail: string;
    contactPhone: string;
    contactTags: string[];
    contactDateUpdated?: string; // from nested contact object — reflects last contact activity
    assignedTo: string | null;
    createdAt: string;
    updatedAt: string;
    lastStatusChangeAt: string;
    stageName?: string;
    locationKey: LocationKey;
}

export interface GHLContact {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    source: string;
    tags: string[];
    dateAdded: string;
    dateUpdated: string;
    city?: string;
    state?: string;
}

export interface PipelineSummary {
    location: LocationKey;
    locationName: string;
    pipelines: {
        id: string;
        name: string;
        stages: {
            id: string;
            name: string;
            position: number;
            count: number;
            value: number;
            opportunities: GHLOpportunity[];
        }[];
        totalOpen: number;
        totalValue: number;
        wonCount: number;
        wonValue: number;
        lostCount: number;
    }[];
}

export interface FullPipelineData {
    locations: PipelineSummary[];
    totals: {
        totalOpen: number;
        totalValue: number;
        totalWon: number;
        totalWonValue: number;
        totalLost: number;
        conversionRate: number;
    };
    sourceBreakdown: { source: string; count: number; value: number }[];
    fetchedAt: string;
}

// --- Config ---

export function getLocations(): GHLLocation[] {
    const locations: GHLLocation[] = [];
    const configs: { key: LocationKey; name: string; envId: string; envKey: string }[] = [
        { key: 'decatur', name: 'Decatur', envId: 'GHL_LOCATION_ID_DECATUR', envKey: 'GHL_API_KEY_DECATUR' },
        { key: 'smyrna', name: 'Smyrna/Vinings', envId: 'GHL_LOCATION_ID_SMYRNA', envKey: 'GHL_API_KEY_SMYRNA' },
        { key: 'kennesaw', name: 'Kennesaw', envId: 'GHL_LOCATION_ID_KENNESAW', envKey: 'GHL_API_KEY_KENNESAW' },
    ];
    for (const c of configs) {
        const locationId = process.env[c.envId];
        const apiKey = process.env[c.envKey];
        if (locationId && apiKey) {
            locations.push({ key: c.key, name: c.name, locationId, apiKey });
        }
    }
    return locations;
}

export function isGHLConfigured(): boolean {
    return getLocations().length > 0;
}

// --- Generic Fetcher ---

async function ghlFetch<T>(apiKey: string, endpoint: string, params?: Record<string, string>): Promise<T> {
    let url = `${GHL_BASE}${endpoint}`;
    if (params) {
        const search = new URLSearchParams(params);
        url += (url.includes('?') ? '&' : '?') + search.toString();
    }

    const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`GHL API error (${res.status}): ${text}`);
    }

    return res.json();
}

// --- Core API Methods ---

export async function getPipelines(location: GHLLocation): Promise<GHLPipeline[]> {
    const data = await ghlFetch<{ pipelines: any[] }>(location.apiKey, '/pipelines/');
    trackCall('ghl', 'getPipelines', false);

    return (data.pipelines || []).map((p: any, idx: number) => ({
        id: p.id,
        name: p.name,
        stages: (p.stages || []).map((s: any, sIdx: number) => ({
            id: s.id,
            name: s.name,
            position: sIdx,
        })),
        locationKey: location.key,
    }));
}

function parseOpportunity(o: any, locationKey: LocationKey): GHLOpportunity {
    return {
        id: o.id,
        name: o.name || 'Unknown',
        monetaryValue: o.monetaryValue || 0,
        pipelineId: o.pipelineId,
        pipelineStageId: o.pipelineStageId,
        status: o.status || 'open',
        source: o.source || '',
        contactId: o.contact?.id || '',
        contactName: o.contact?.name || o.name || '',
        contactEmail: o.contact?.email || '',
        contactPhone: o.contact?.phone || '',
        contactTags: o.contact?.tags || [],
        contactDateUpdated: o.contact?.dateUpdated || undefined,
        assignedTo: o.assignedTo || null,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
        lastStatusChangeAt: o.lastStatusChangeAt || o.updatedAt,
        locationKey,
    };
}

interface OpportunityMeta {
    total?: number;
    startAfter?: number;
    startAfterId?: string;
    nextPage?: number | null;
}

export async function getOpportunities(
    location: GHLLocation,
    pipelineId: string,
    options?: { status?: string; maxPages?: number },
): Promise<{ opportunities: GHLOpportunity[]; total: number }> {
    const allOpps: GHLOpportunity[] = [];
    let startAfter: number | undefined;
    let startAfterId: string | undefined;
    let total = 0;
    const maxPages = options?.maxPages || 50;

    for (let page = 0; page < maxPages; page++) {
        const params: Record<string, string> = { limit: '100' };
        if (options?.status) params.status = options.status;
        if (startAfter !== undefined) params.startAfter = startAfter.toString();
        if (startAfterId) params.startAfterId = startAfterId;

        const data = await ghlFetch<{ opportunities: any[]; meta?: OpportunityMeta }>(
            location.apiKey,
            `/pipelines/${pipelineId}/opportunities`,
            params
        );
        trackCall('ghl', 'getOpportunities', false);

        total = data.meta?.total || total;
        const opps = (data.opportunities || []).map(o => parseOpportunity(o, location.key));
        allOpps.push(...opps);

        // Stop if no more pages
        if (!data.meta?.nextPage || opps.length < 100) break;
        startAfter = data.meta.startAfter;
        startAfterId = data.meta.startAfterId;
    }

    return { opportunities: allOpps, total };
}

/** Get just the count for a status without fetching all records */
export async function getOpportunityCount(
    location: GHLLocation,
    pipelineId: string,
    status: string,
): Promise<number> {
    const data = await ghlFetch<{ meta?: { total?: number } }>(
        location.apiKey,
        `/pipelines/${pipelineId}/opportunities`,
        { limit: '1', status }
    );
    trackCall('ghl', 'getOpportunityCount', false);
    return data.meta?.total || 0;
}

export async function getContacts(
    location: GHLLocation,
    limit = 100,
    startAfter?: number,
): Promise<{ contacts: GHLContact[]; total: number }> {
    const params: Record<string, string> = { limit: limit.toString() };
    if (startAfter) params.startAfter = startAfter.toString();

    const data = await ghlFetch<{ contacts: any[]; meta?: { total?: number } }>(
        location.apiKey,
        '/contacts/',
        params
    );
    trackCall('ghl', 'getContacts', false);

    const contacts: GHLContact[] = (data.contacts || []).map((c: any) => ({
        id: c.id,
        firstName: c.firstName || '',
        lastName: c.lastName || '',
        email: c.email || '',
        phone: c.phone || '',
        source: c.source || '',
        tags: c.tags || [],
        dateAdded: c.dateAdded,
        dateUpdated: c.dateUpdated,
        city: c.city,
        state: c.state,
    }));

    return { contacts, total: data.meta?.total || contacts.length };
}

export async function getContact(location: GHLLocation, contactId: string): Promise<GHLContact | null> {
    try {
        const data = await ghlFetch<{ contact: any }>(
            location.apiKey,
            `/contacts/${contactId}`
        );
        trackCall('ghl', 'getContact', false);

        const c = data.contact;
        if (!c) return null;

        return {
            id: c.id,
            firstName: c.firstName || '',
            lastName: c.lastName || '',
            email: c.email || '',
            phone: c.phone || '',
            source: c.source || '',
            tags: c.tags || [],
            dateAdded: c.dateAdded,
            dateUpdated: c.dateUpdated,
            city: c.city,
            state: c.state,
        };
    } catch {
        return null;
    }
}

// --- Cache ---

let pipelineCache: { data: FullPipelineData; timestamp: number } | null = null;
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

function getCachedPipelineData(): FullPipelineData | null {
    if (pipelineCache && (Date.now() - pipelineCache.timestamp) < CACHE_TTL) {
        trackCall('ghl', 'getFullPipelineData', true);
        return pipelineCache.data;
    }
    return null;
}

// --- Master Aggregator ---

export async function getFullPipelineData(options?: {
    locationFilter?: LocationKey;
    forceRefresh?: boolean;
}): Promise<FullPipelineData> {
    if (!options?.forceRefresh) {
        const cached = getCachedPipelineData();
        if (cached) {
            if (options?.locationFilter) {
                return {
                    ...cached,
                    locations: cached.locations.filter(l => l.location === options.locationFilter),
                };
            }
            return cached;
        }
    }

    const locations = getLocations();
    if (locations.length === 0) {
        throw new Error('No GHL locations configured');
    }

    const locationSummaries: PipelineSummary[] = [];
    const sourceMap = new Map<string, { count: number; value: number }>();

    for (const loc of locations) {
        try {
            const pipelines = await getPipelines(loc);
            const pipelineData = [];

            for (const pipeline of pipelines) {
                // Fetch open opportunities (full details for pipeline analysis)
                // and just counts for won/lost/abandoned (saves API calls)
                const [openResult, wonCount, lostCount, abandonedCount] = await Promise.all([
                    getOpportunities(loc, pipeline.id, { status: 'open', maxPages: 30 }),
                    getOpportunityCount(loc, pipeline.id, 'won'),
                    getOpportunityCount(loc, pipeline.id, 'lost'),
                    getOpportunityCount(loc, pipeline.id, 'abandoned'),
                ]);

                const openOpps = openResult.opportunities;

                // Group open opps by stage
                const stageMap = new Map<string, {
                    count: number;
                    value: number;
                    opportunities: GHLOpportunity[];
                }>();

                for (const stage of pipeline.stages) {
                    stageMap.set(stage.id, { count: 0, value: 0, opportunities: [] });
                }

                let totalOpen = 0, totalValue = 0;

                for (const opp of openOpps) {
                    const stage = pipeline.stages.find(s => s.id === opp.pipelineStageId);
                    opp.stageName = stage?.name || 'Unknown';

                    // Track source
                    const src = opp.source || 'Unknown';
                    const existing = sourceMap.get(src) || { count: 0, value: 0 };
                    existing.count++;
                    existing.value += opp.monetaryValue;
                    sourceMap.set(src, existing);

                    totalOpen++;
                    totalValue += opp.monetaryValue;

                    const stageData = stageMap.get(opp.pipelineStageId);
                    if (stageData) {
                        stageData.count++;
                        stageData.value += opp.monetaryValue;
                        stageData.opportunities.push(opp);
                    }
                }

                pipelineData.push({
                    id: pipeline.id,
                    name: pipeline.name,
                    stages: pipeline.stages.map(s => {
                        const d = stageMap.get(s.id) || { count: 0, value: 0, opportunities: [] };
                        return { ...s, ...d };
                    }),
                    totalOpen,
                    totalValue,
                    wonCount,
                    wonValue: 0, // would need full fetch of won opps to compute — keep lean
                    lostCount: lostCount + abandonedCount,
                });
            }

            locationSummaries.push({
                location: loc.key,
                locationName: loc.name,
                pipelines: pipelineData,
            });
        } catch (error) {
            console.error(`[GHL] Failed to fetch data for ${loc.name}:`, error);
            locationSummaries.push({
                location: loc.key,
                locationName: loc.name,
                pipelines: [],
            });
        }
    }

    // Compute totals
    let totalOpen = 0, totalValue = 0, totalWon = 0, totalWonValue = 0, totalLost = 0;
    for (const loc of locationSummaries) {
        for (const p of loc.pipelines) {
            totalOpen += p.totalOpen;
            totalValue += p.totalValue;
            totalWon += p.wonCount;
            totalWonValue += p.wonValue;
            totalLost += p.lostCount;
        }
    }

    const totalClosed = totalWon + totalLost;
    const conversionRate = totalClosed > 0 ? Math.round((totalWon / totalClosed) * 100) : 0;

    // Source breakdown sorted by count
    const sourceBreakdown = Array.from(sourceMap.entries())
        .map(([source, data]) => ({ source, ...data }))
        .sort((a, b) => b.count - a.count);

    const result: FullPipelineData = {
        locations: locationSummaries,
        totals: { totalOpen, totalValue, totalWon, totalWonValue, totalLost, conversionRate },
        sourceBreakdown,
        fetchedAt: new Date().toISOString(),
    };

    // Cache the full result
    pipelineCache = { data: result, timestamp: Date.now() };

    if (options?.locationFilter) {
        return {
            ...result,
            locations: result.locations.filter(l => l.location === options.locationFilter),
        };
    }

    return result;
}

// --- Stale Lead Analysis ---

export interface StaleLead {
    opportunity: GHLOpportunity;
    daysSinceActivity: number;
    staleness: 'at-risk' | 'stale' | 'dormant';
    lastActivitySource: 'opportunity' | 'contact'; // which timestamp determined staleness
    locationKey: LocationKey;
    locationName: string;
    pipelineName: string;
    stageName: string;
}

// Separate cache for contact dateUpdated values (avoids re-fetching on every call)
const contactDateCache = new Map<string, { dateUpdated: string | null; timestamp: number }>();
const CONTACT_CACHE_TTL = 15 * 60 * 1000; // 15 minutes

/** Batch-fetch with concurrency limit */
async function batchAsync<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
    for (let i = 0; i < items.length; i += concurrency) {
        await Promise.all(items.slice(i, i + concurrency).map(fn));
    }
}

export async function getStaleLeads(locationFilter?: LocationKey): Promise<StaleLead[]> {
    const pipelineData = await getFullPipelineData({ locationFilter });
    const now = Date.now();
    const MS_PER_DAY = 1000 * 60 * 60 * 24;

    // Build location lookup for contact fetching
    const locationsByKey = new Map<LocationKey, GHLLocation>();
    for (const loc of getLocations()) locationsByKey.set(loc.key, loc);

    // Helper: get most recent timestamp from multiple date strings
    function mostRecentMs(...dates: (string | undefined | null)[]): number {
        let max = 0;
        for (const d of dates) {
            if (d) {
                const ms = new Date(d).getTime();
                if (ms > max) max = ms;
            }
        }
        return max;
    }

    // First pass: find opportunities that look stale by opp data alone
    interface CandidateLead {
        opp: GHLOpportunity;
        oppDaysSince: number;
        contactDaysSince: number | null;
        locationKey: LocationKey;
        locationName: string;
        pipelineName: string;
        stageName: string;
    }
    const candidates: CandidateLead[] = [];
    let hasAnyContactDate = false;

    for (const locSummary of pipelineData.locations) {
        for (const pipeline of locSummary.pipelines) {
            for (const stage of pipeline.stages) {
                for (const opp of stage.opportunities) {
                    // Use the MOST RECENT of all opp timestamps (not fallback chain)
                    const oppMs = mostRecentMs(opp.lastStatusChangeAt, opp.updatedAt, opp.createdAt);
                    if (!oppMs) continue;

                    const oppDaysSince = Math.floor((now - oppMs) / MS_PER_DAY);
                    if (oppDaysSince < 14) continue; // Not stale by any measure

                    // Check if contactDateUpdated came from the opportunity response (Layer 1)
                    let contactDaysSince: number | null = null;
                    if (opp.contactDateUpdated) {
                        hasAnyContactDate = true;
                        contactDaysSince = Math.floor((now - new Date(opp.contactDateUpdated).getTime()) / MS_PER_DAY);
                    }

                    candidates.push({
                        opp, oppDaysSince, contactDaysSince,
                        locationKey: locSummary.location,
                        locationName: locSummary.locationName,
                        pipelineName: pipeline.name,
                        stageName: stage.name,
                    });
                }
            }
        }
    }

    // Layer 2 fallback: fetch contact dateUpdated for stale candidates
    // Only fires if contactDateUpdated wasn't in the opportunity response
    if (!hasAnyContactDate && candidates.length > 0) {
        // Filter to candidates we haven't cached yet
        const needsFetch = candidates.filter(c => {
            if (!c.opp.contactId) return false;
            const cached = contactDateCache.get(c.opp.contactId);
            if (cached && (now - cached.timestamp) < CONTACT_CACHE_TTL) {
                // Use cached value
                if (cached.dateUpdated) {
                    c.contactDaysSince = Math.floor((now - new Date(cached.dateUpdated).getTime()) / MS_PER_DAY);
                }
                return false;
            }
            return true;
        });

        if (needsFetch.length > 0) {
            console.log(`[ghl-stale] Fetching ${needsFetch.length} contacts for dateUpdated (${candidates.length - needsFetch.length} cached)`);
            await batchAsync(needsFetch, 20, async (c) => {
                const location = locationsByKey.get(c.opp.locationKey);
                if (!location) return;
                const contact = await getContact(location, c.opp.contactId);
                const dateUpdated = contact?.dateUpdated || null;
                contactDateCache.set(c.opp.contactId, { dateUpdated, timestamp: now });
                if (dateUpdated) {
                    c.contactDaysSince = Math.floor((now - new Date(dateUpdated).getTime()) / MS_PER_DAY);
                }
            });
        }
    }

    // Final classification using the most recent activity (opp or contact)
    const staleLeads: StaleLead[] = [];
    for (const c of candidates) {
        const daysSince = c.contactDaysSince !== null
            ? Math.min(c.oppDaysSince, c.contactDaysSince)
            : c.oppDaysSince;
        const activitySource: 'opportunity' | 'contact' =
            (c.contactDaysSince !== null && c.contactDaysSince < c.oppDaysSince) ? 'contact' : 'opportunity';

        let staleness: 'at-risk' | 'stale' | 'dormant' | null = null;
        if (daysSince >= 60) staleness = 'dormant';
        else if (daysSince >= 30) staleness = 'stale';
        else if (daysSince >= 14) staleness = 'at-risk';

        if (staleness) {
            staleLeads.push({
                opportunity: c.opp,
                daysSinceActivity: daysSince,
                staleness,
                lastActivitySource: activitySource,
                locationKey: c.locationKey,
                locationName: c.locationName,
                pipelineName: c.pipelineName,
                stageName: c.stageName,
            });
        }
    }

    staleLeads.sort((a, b) => b.daysSinceActivity - a.daysSinceActivity);
    return staleLeads;
}
