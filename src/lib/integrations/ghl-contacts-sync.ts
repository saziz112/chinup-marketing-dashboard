/**
 * GHL Contacts Full Sync
 * Backfills ALL GHL contacts (31K+) across 3 locations into Postgres.
 * Provides a complete phone map for MindBody→GHL matching.
 * Uses v1 JWT tokens (GET /v1/contacts/?limit=100, paginated).
 */

import { sql } from '@vercel/postgres';
import { getLocations, type LocationKey } from './gohighlevel';
import { normalizePhone } from './mindbody';
import type { PhoneMapEntry } from './ghl-conversations';
import { trackCall } from '@/lib/api-usage-tracker';

const GHL_BASE = 'https://rest.gohighlevel.com/v1';

// ---------------------------------------------------------------------------
// Backfill ALL GHL Contacts
// ---------------------------------------------------------------------------

const PAGES_PER_CHUNK = 5; // 5 pages × 100 contacts = 500 per invocation (~15-20s)

/**
 * Backfill GHL contacts — chunked (PAGES_PER_CHUNK pages per call).
 * Returns `done: false` + `continue: true` while more pages remain.
 * Progress stored in mb_sync_state (ghl_backfill_progress row).
 */
export async function backfillGhlContacts(): Promise<{
    total: number; apiCalls: number; done: boolean; chunkLabel: string; continue?: boolean;
}> {
    // Ensure cursor_data column exists (self-migration)
    await sql`ALTER TABLE mb_sync_state ADD COLUMN IF NOT EXISTS cursor_data TEXT`.catch(() => {});

    // If already completed, skip
    const finalState = await sql`SELECT 1 FROM mb_sync_state WHERE sync_type = 'ghl-contacts'`;
    if (finalState.rows.length > 0) {
        return { total: 0, apiCalls: 0, done: true, chunkLabel: 'GHL contacts backfill already complete' };
    }

    const locations = getLocations();

    // Load progress
    const progressRow = await sql`SELECT total_records, cursor_data FROM mb_sync_state WHERE sync_type = 'ghl_backfill_progress'`;
    let locationIndex = 0;
    let startAfter: number | undefined;    // numeric timestamp from GHL meta
    let startAfterId: string | undefined;  // contact ID from GHL meta
    let totalSoFar = 0;

    if (progressRow.rows.length > 0) {
        const cursor = progressRow.rows[0].cursor_data ? JSON.parse(progressRow.rows[0].cursor_data) : {};
        locationIndex = cursor.locationIndex || 0;
        startAfter = cursor.startAfter != null ? Number(cursor.startAfter) : undefined;
        startAfterId = cursor.startAfterId || undefined;
        totalSoFar = progressRow.rows[0].total_records || 0;
    }

    // If we've gone past all locations, we're done
    if (locationIndex >= locations.length) {
        // Finalize
        await sql`
            INSERT INTO mb_sync_state (sync_type, last_sync_date, total_records, updated_at)
            VALUES ('ghl-contacts', ${new Date().toISOString().split('T')[0]}, ${totalSoFar}, NOW())
            ON CONFLICT (sync_type)
            DO UPDATE SET last_sync_date = ${new Date().toISOString().split('T')[0]},
                          total_records = ${totalSoFar}, updated_at = NOW()
        `;
        await sql`DELETE FROM mb_sync_state WHERE sync_type = 'ghl_backfill_progress'`;
        return { total: totalSoFar, apiCalls: 0, done: true, chunkLabel: `GHL backfill complete — ${totalSoFar} contacts` };
    }

    const loc = locations[locationIndex];
    let apiCalls = 0;
    let chunkInserted = 0;
    let locationDone = false;

    // Process PAGES_PER_CHUNK pages for the current location
    for (let page = 0; page < PAGES_PER_CHUNK; page++) {
        const url = new URL(`${GHL_BASE}/contacts/`);
        url.searchParams.set('limit', '100');
        if (startAfter !== undefined) url.searchParams.set('startAfter', String(startAfter));
        if (startAfterId) url.searchParams.set('startAfterId', startAfterId);

        const res = await fetch(url.toString(), {
            headers: { 'Authorization': `Bearer ${loc.apiKey}` },
        });
        trackCall('ghl', 'contacts-sync', false);
        apiCalls++;

        if (!res.ok) {
            console.error(`[ghl-sync] Failed to fetch contacts for ${loc.name}: ${res.status}`);
            locationDone = true;
            break;
        }

        const data = await res.json();
        const contacts = data.contacts || [];
        if (contacts.length === 0) { locationDone = true; break; }

        for (const c of contacts) {
            const phone = normalizePhone(c.phone || c.companyPhone || '');
            const email = (c.email || '').toLowerCase().trim();
            const name = c.contactName || c.name || `${c.firstName || ''} ${c.lastName || ''}`.trim();
            const dnd = c.dnd === true;
            const tags: string[] = c.tags || [];

            await sql`
                INSERT INTO ghl_contacts_map
                    (contact_id, location_key, phone_normalized, email, contact_name, dnd_global, tags, created_at, updated_at, synced_at)
                VALUES (${c.id}, ${loc.key}, ${phone || null}, ${email || null}, ${name},
                        ${dnd}, ${JSON.stringify(tags)}, ${c.dateAdded || null}, ${c.dateUpdated || null}, NOW())
                ON CONFLICT (contact_id, location_key) DO UPDATE SET
                    phone_normalized = ${phone || null},
                    email = ${email || null},
                    contact_name = ${name},
                    dnd_global = ${dnd},
                    tags = ${JSON.stringify(tags)},
                    updated_at = ${c.dateUpdated || null},
                    synced_at = NOW()
            `;
            chunkInserted++;
        }

        // Use meta pagination cursors from GHL API response
        const meta = data.meta;
        if (!meta?.nextPage || contacts.length < 100) { locationDone = true; break; }
        startAfter = meta.startAfter;
        startAfterId = meta.startAfterId;
        await new Promise(r => setTimeout(r, 100));
    }

    // Advance to next location if this one is done
    const nextLocationIndex = locationDone ? locationIndex + 1 : locationIndex;
    const nextStartAfter = locationDone ? undefined : startAfter;
    const nextStartAfterId = locationDone ? undefined : startAfterId;
    const newTotal = totalSoFar + chunkInserted;

    // Save progress
    const cursorJson = JSON.stringify({ locationIndex: nextLocationIndex, startAfter: nextStartAfter, startAfterId: nextStartAfterId });
    await sql`
        INSERT INTO mb_sync_state (sync_type, last_sync_date, total_records, cursor_data, updated_at)
        VALUES ('ghl_backfill_progress', ${new Date().toISOString().split('T')[0]}, ${newTotal}, ${cursorJson}, NOW())
        ON CONFLICT (sync_type) DO UPDATE SET
            total_records = ${newTotal},
            cursor_data = ${cursorJson},
            updated_at = NOW()
    `;

    // Check if fully done (all locations processed)
    const allDone = nextLocationIndex >= locations.length;
    if (allDone) {
        await sql`
            INSERT INTO mb_sync_state (sync_type, last_sync_date, total_records, updated_at)
            VALUES ('ghl-contacts', ${new Date().toISOString().split('T')[0]}, ${newTotal}, NOW())
            ON CONFLICT (sync_type)
            DO UPDATE SET last_sync_date = ${new Date().toISOString().split('T')[0]},
                          total_records = ${newTotal}, updated_at = NOW()
        `;
        await sql`DELETE FROM mb_sync_state WHERE sync_type = 'ghl_backfill_progress'`;
    }

    const locName = loc.name || loc.key;
    const chunkLabel = allDone
        ? `GHL backfill complete — ${newTotal} contacts`
        : `${locName}: +${chunkInserted} contacts (${newTotal} total)`;

    console.log(`[ghl-sync] Chunk: ${chunkLabel}, ${apiCalls} API calls`);
    return { total: chunkInserted, apiCalls, done: allDone, chunkLabel, continue: !allDone };
}

// ---------------------------------------------------------------------------
// Incremental GHL Contacts Sync
// ---------------------------------------------------------------------------

/**
 * Fetch only recently updated contacts since last sync.
 * Uses v1 contacts endpoint — no date filter, but we can compare dateUpdated.
 * For efficiency, we paginate until we hit contacts older than our last sync.
 */
export async function incrementalGhlSync(): Promise<{ newContacts: number; apiCalls: number }> {
    const stateResult = await sql`
        SELECT last_sync_date FROM mb_sync_state WHERE sync_type = 'ghl-contacts'
    `;
    if (stateResult.rows.length === 0) {
        console.log('[ghl-sync] No sync state — run full backfill first');
        return { newContacts: 0, apiCalls: 0 };
    }

    const lastSync = new Date(stateResult.rows[0].last_sync_date);
    const locations = getLocations();
    let newContacts = 0;
    let apiCalls = 0;

    for (const loc of locations) {
        let pgStartAfter: number | undefined;
        let pgStartAfterId: string | undefined;
        let locationNew = 0;
        let reachedOldContacts = false;

        while (!reachedOldContacts) {
            const url = new URL(`${GHL_BASE}/contacts/`);
            url.searchParams.set('limit', '100');
            url.searchParams.set('sortBy', 'date_updated');
            url.searchParams.set('order', 'desc');
            if (pgStartAfter !== undefined) url.searchParams.set('startAfter', String(pgStartAfter));
            if (pgStartAfterId) url.searchParams.set('startAfterId', pgStartAfterId);

            const res = await fetch(url.toString(), {
                headers: { 'Authorization': `Bearer ${loc.apiKey}` },
            });
            trackCall('ghl', 'contacts-sync-incremental', false);
            apiCalls++;

            if (!res.ok) break;

            const data = await res.json();
            const contacts = data.contacts || [];
            if (contacts.length === 0) break;

            for (const c of contacts) {
                const updated = c.dateUpdated ? new Date(c.dateUpdated) : null;
                if (updated && updated < lastSync) {
                    reachedOldContacts = true;
                    break;
                }

                const phone = normalizePhone(c.phone || c.companyPhone || '');
                const email = (c.email || '').toLowerCase().trim();
                const name = c.contactName || c.name || `${c.firstName || ''} ${c.lastName || ''}`.trim();

                await sql`
                    INSERT INTO ghl_contacts_map
                        (contact_id, location_key, phone_normalized, email, contact_name, dnd_global, tags, created_at, updated_at, synced_at)
                    VALUES (${c.id}, ${loc.key}, ${phone || null}, ${email || null}, ${name},
                            ${c.dnd === true}, ${JSON.stringify(c.tags || [])}, ${c.dateAdded || null}, ${c.dateUpdated || null}, NOW())
                    ON CONFLICT (contact_id, location_key) DO UPDATE SET
                        phone_normalized = ${phone || null},
                        email = ${email || null},
                        contact_name = ${name},
                        dnd_global = ${c.dnd === true},
                        tags = ${JSON.stringify(c.tags || [])},
                        updated_at = ${c.dateUpdated || null},
                        synced_at = NOW()
                `;
                locationNew++;
            }

            // Use meta pagination cursors from GHL API response
            const meta = data.meta;
            if (!meta?.nextPage || contacts.length < 100) break;
            pgStartAfter = meta.startAfter;
            pgStartAfterId = meta.startAfterId;
            await new Promise(r => setTimeout(r, 100));
        }

        newContacts += locationNew;
    }

    // Update sync state
    await sql`
        UPDATE mb_sync_state
        SET last_sync_date = ${new Date().toISOString().split('T')[0]},
            total_records = (SELECT COUNT(*) FROM ghl_contacts_map),
            updated_at = NOW()
        WHERE sync_type = 'ghl-contacts'
    `;

    console.log(`[ghl-sync] Incremental sync: ${newContacts} new/updated, ${apiCalls} API calls`);
    return { newContacts, apiCalls };
}

// ---------------------------------------------------------------------------
// Full Phone Map from Postgres
// ---------------------------------------------------------------------------

/** In-memory cache for the full phone map from Postgres */
let pgPhoneMapCache: { data: Map<string, PhoneMapEntry>; timestamp: number } | null = null;
const PG_PHONE_MAP_TTL = 30 * 60 * 1000; // 30 min

/**
 * Build a phone map from ALL GHL contacts in Postgres.
 * Returns empty map if no data in ghl_contacts_map (fallback to pipeline-based).
 */
export async function getFullPhoneMap(locationFilter?: LocationKey): Promise<Map<string, PhoneMapEntry>> {
    // Check cache
    if (pgPhoneMapCache && (Date.now() - pgPhoneMapCache.timestamp) < PG_PHONE_MAP_TTL) {
        if (!locationFilter) return pgPhoneMapCache.data;
        const filtered = new Map<string, PhoneMapEntry>();
        for (const [phone, entry] of pgPhoneMapCache.data) {
            if (entry.locationKey === locationFilter) filtered.set(phone, entry);
        }
        return filtered;
    }

    // Check if we have any data
    const countResult = await sql`SELECT COUNT(*) as cnt FROM ghl_contacts_map WHERE phone_normalized IS NOT NULL AND phone_normalized != ''`;
    const count = Number(countResult.rows[0]?.cnt || 0);
    if (count === 0) return new Map();

    // Fetch all contacts with phones from Postgres
    const result = await sql`
        SELECT contact_id, location_key, phone_normalized, email, contact_name, dnd_global, tags
        FROM ghl_contacts_map
        WHERE phone_normalized IS NOT NULL AND phone_normalized != ''
        ORDER BY updated_at DESC NULLS LAST
    `;

    const phoneMap = new Map<string, PhoneMapEntry>();
    // Process: for duplicate phones, pick most recently updated, merge DND across locations
    const phoneEntries = new Map<string, { entries: Array<{ row: (typeof result.rows)[0] }> }>();

    for (const row of result.rows) {
        const phone = row.phone_normalized;
        if (!phone || phone.length < 10) continue;
        if (!phoneEntries.has(phone)) phoneEntries.set(phone, { entries: [] });
        phoneEntries.get(phone)!.entries.push({ row });
    }

    for (const [phone, { entries }] of phoneEntries) {
        // DND = true if ANY location has DND
        const dnd = entries.some(e => e.row.dnd_global);
        // Pick the most recently updated entry
        const best = entries[0]; // already sorted by updated_at DESC

        const allTags = new Set<string>();
        for (const e of entries) {
            if (Array.isArray(e.row.tags)) {
                for (const t of e.row.tags) allTags.add(t);
            }
        }

        phoneMap.set(phone, {
            contactId: best.row.contact_id,
            contactName: best.row.contact_name || '',
            contactEmail: best.row.email || '',
            locationKey: best.row.location_key as LocationKey,
            tags: [...allTags],
            dnd,
            dndEmail: dnd, // Use global DND for email too (v2 check will refine later)
        });
    }

    // Cache
    pgPhoneMapCache = { data: phoneMap, timestamp: Date.now() };
    console.log(`[ghl-sync] Built full phone map from Postgres: ${phoneMap.size} unique phones from ${result.rows.length} contacts`);

    if (locationFilter) {
        const filtered = new Map<string, PhoneMapEntry>();
        for (const [phone, entry] of phoneMap) {
            if (entry.locationKey === locationFilter) filtered.set(phone, entry);
        }
        return filtered;
    }

    return phoneMap;
}

/**
 * Get GHL contacts sync statistics for admin panel.
 */
export async function getGhlSyncStats(): Promise<{
    totalContacts: number;
    byLocation: Record<string, number>;
    withPhone: number;
    withEmail: number;
    lastSync: string | null;
}> {
    try {
        const [total, byLoc, withPhone, withEmail, state] = await Promise.all([
            sql`SELECT COUNT(*) as cnt FROM ghl_contacts_map`.then(r => Number(r.rows[0]?.cnt || 0)),
            sql`SELECT location_key, COUNT(*) as cnt FROM ghl_contacts_map GROUP BY location_key`.then(r => {
                const map: Record<string, number> = {};
                for (const row of r.rows) map[row.location_key] = Number(row.cnt);
                return map;
            }),
            sql`SELECT COUNT(*) as cnt FROM ghl_contacts_map WHERE phone_normalized IS NOT NULL AND phone_normalized != ''`.then(r => Number(r.rows[0]?.cnt || 0)),
            sql`SELECT COUNT(*) as cnt FROM ghl_contacts_map WHERE email IS NOT NULL AND email != ''`.then(r => Number(r.rows[0]?.cnt || 0)),
            sql`SELECT last_sync_date FROM mb_sync_state WHERE sync_type = 'ghl-contacts'`.then(r => r.rows[0]?.last_sync_date || null),
        ]);

        return { totalContacts: total, byLocation: byLoc, withPhone, withEmail, lastSync: state };
    } catch {
        return { totalContacts: 0, byLocation: {}, withPhone: 0, withEmail: 0, lastSync: null };
    }
}
