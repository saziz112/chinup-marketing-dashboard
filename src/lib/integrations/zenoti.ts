/**
 * Zenoti API Client (marketing dashboard) — READ-ONLY.
 *
 * Ported from the Monthly Bonus Dashboard's `src/lib/zenoti.ts` +
 * `zenotiSales.ts` (fetch half only — the bonus/provider-attribution logic
 * stays in the monthly app). This app consumes Zenoti purely to keep the
 * patient-segmentation tables (mb_sales_history / mb_clients_cache /
 * mb_appointments_history) current after the 2026-06-29 go-live.
 *
 * Endpoints verified live 2026-07-01 (monthly-dashboard probes).
 *
 * Platform constraints:
 * - Rate limit: 60 calls/min ORG-WIDE (shared with HyperConnect) — 429 + Retry-After.
 * - Appointment queries: max 7-day window → chunked here.
 * - Sales report window: passed as a datetime range; paginated (size 100).
 * - All IDs are GUIDs (strings), unlike Mindbody's numeric IDs — so Zenoti and
 *   Mindbody rows coexist in the same unified tables without key collision.
 */

import { trackCall } from '@/lib/api-usage-tracker';

// --- Locations ---

export type ZenotiLocationKey = 'decatur' | 'kennesaw' | 'vinings';

const CENTER_ENV_KEYS: Record<ZenotiLocationKey, string> = {
    decatur: 'ZENOTI_CENTER_ID_DECATUR',
    kennesaw: 'ZENOTI_CENTER_ID_KENNESAW',
    vinings: 'ZENOTI_CENTER_ID_VININGS',
};

export const ZENOTI_LOCATIONS: ZenotiLocationKey[] = ['decatur', 'kennesaw', 'vinings'];

function getEnv(key: string): string {
    const val = process.env[key];
    if (!val) throw new Error(`Missing env var: ${key}`);
    return val;
}

export function getCenterId(location: ZenotiLocationKey): string {
    return getEnv(CENTER_ENV_KEYS[location]);
}

/** Stable, distinct numeric LocationIds for the three centers, mirroring the
 *  monthly dashboard's mapping. Used only for the location_id column — these do
 *  NOT reuse Mindbody's LocationId values (irrelevant after cutover). */
export const ZENOTI_LOCATION_IDS: Record<ZenotiLocationKey, number> = {
    decatur: 1,
    kennesaw: 2,
    vinings: 3,
};

export function centerIdToLocationId(centerId: string): number {
    for (const key of ZENOTI_LOCATIONS) {
        if (process.env[CENTER_ENV_KEYS[key]] === centerId) return ZENOTI_LOCATION_IDS[key];
    }
    return 0;
}

// --- Appointment status enum ---
// -2/-1/0/1 documented (verified Jun 2026). 4 and 10 pinned empirically from
// live data 2026-07-01: 4 = Confirmed (today/future only); 10 = Blockout (no
// service attached — /v1/appointments includes block-out rows; filter them).

export const ZENOTI_APPT_STATUS = {
    NO_SHOW: -2,
    CANCELLED: -1,
    NEW: 0,
    CLOSED: 1,
    CONFIRMED: 4,
    BLOCKOUT: 10,
} as const;

/**
 * Map a Zenoti status enum to the string statuses the marketing tables use
 * (mb_appointments_history.status, as written by the Mindbody sync). This keeps
 * every downstream read — the lapsed activity view keys on 'Completed'/'Arrived',
 * the future-booked exclusion on 'Booked'/'Confirmed' — working unchanged.
 * Returns null for Blockout (no service) so the caller can skip the row.
 */
export function zenotiStatusToMbStatus(status: number): string | null {
    switch (status) {
        case ZENOTI_APPT_STATUS.CLOSED: return 'Completed'; // service delivered
        case ZENOTI_APPT_STATUS.CONFIRMED: return 'Confirmed';
        case ZENOTI_APPT_STATUS.NEW: return 'Booked';
        case ZENOTI_APPT_STATUS.CANCELLED: return 'Cancelled'; // native — Mindbody dropped these
        case ZENOTI_APPT_STATUS.NO_SHOW: return 'NoShow';
        case ZENOTI_APPT_STATUS.BLOCKOUT: return null; // skip
        default: return null;
    }
}

// --- Types (fields we consume; payloads carry more) ---

export interface ZenotiTherapist {
    id: string;
    first_name: string;
    last_name: string;
}

export interface ZenotiGuestSummary {
    id: string;
    first_name: string;
    last_name: string;
    email: string | null;
    mobile: { country_id: number; number: string | null; display_number: string | null } | null;
}

export interface ZenotiAppointment {
    appointment_id: string;
    appointment_group_id: string | null;
    invoice_id: string | null;
    service: {
        id: string;
        name: string;
        is_addon: boolean;
        category: { id: string; name: string } | null;
        sub_category: { id: string; name: string } | null;
    } | null;
    start_time: string; // center TZ
    start_time_utc: string;
    end_time: string;
    end_time_utc: string;
    status: number;
    therapist: ZenotiTherapist | null;
    guest: ZenotiGuestSummary | null;
    /** Injected by getZenotiAppointments — not part of the Zenoti payload. */
    location: ZenotiLocationKey;
    center_id: string;
}

export interface ZenotiCenter {
    id: string;
    code: string;
    name: string;
}

/**
 * One line row from the Zenoti sales accrual flat_file report. The payload
 * carries ~70 columns; these are the ones the marketing sync consumes.
 */
export interface ZenotiSalesRow {
    invoice_id: string;
    invoice_item_id?: string; // per-line GUID — used as sale_id
    invoice_no: string;
    sale_date: string;        // "YYYY-MM-DDTHH:mm:ss" (center-local)
    invoice_date: string;
    item_name: string;
    item_type: string;        // Service | Product | Package | Membership | Gift card | Pre-paid card
    item_category: string;    // Injectables | Retail Skincare | Aesthetic Services | …
    sold_by: string;
    sold_by_id: string;
    serviced_by?: string;
    collected: number;        // cash collected, INCLUSIVE of tax (negative on refunds)
    tax: number;
    discount: number;
    price: number;
    qty: number;
    sales_exc_tax?: number;
    redeemed?: number;
    sale_type: string;        // Sale | Refund | Charges
    status: string;           // Closed | Open
    guest_id: string;
    guest_name: string;
    center_id: string;
}

// --- Core fetch ---

const BASE_URL = 'https://api.zenoti.com';
const MAX_429_RETRIES = 3;

export async function zenotiCall<T>(
    method: 'GET' | 'POST',
    endpoint: string,
    body?: Record<string, unknown>
): Promise<T> {
    const headers: Record<string, string> = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `apikey ${getEnv('ZENOTI_API_KEY')}`,
    };

    const options: RequestInit = { method, headers };
    if (body) {
        options.body = JSON.stringify(body);
    }

    for (let attempt = 0; ; attempt++) {
        const response = await fetch(`${BASE_URL}${endpoint}`, options);

        if (response.status === 429 && attempt < MAX_429_RETRIES) {
            const retryAfter = Number(response.headers.get('Retry-After')) || 5;
            await new Promise(r => setTimeout(r, retryAfter * 1000));
            continue;
        }

        trackCall('zenoti', endpoint.split('?')[0], false);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(
                `Zenoti API error: ${response.status} ${endpoint} — ${JSON.stringify(errorData)}`
            );
        }

        return response.json() as Promise<T>;
    }
}

// --- Date chunking (Zenoti caps appointment queries at 7 days) ---

/**
 * Split an inclusive YYYY-MM-DD date range into chunks of at most `maxDays` days.
 * Chunks are contiguous and non-overlapping: [start..start+6], [start+7..], …
 */
export function chunkDateRange(
    startDate: string,
    endDate: string,
    maxDays = 7
): { start: string; end: string }[] {
    const start = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T00:00:00Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
        throw new Error(`Invalid date range: ${startDate}..${endDate}`);
    }

    const chunks: { start: string; end: string }[] = [];
    const cursor = new Date(start);
    while (cursor <= end) {
        const chunkEnd = new Date(cursor);
        chunkEnd.setUTCDate(chunkEnd.getUTCDate() + maxDays - 1);
        if (chunkEnd > end) chunkEnd.setTime(end.getTime());
        chunks.push({
            start: cursor.toISOString().slice(0, 10),
            end: chunkEnd.toISOString().slice(0, 10),
        });
        cursor.setUTCDate(cursor.getUTCDate() + maxDays);
    }
    return chunks;
}

// --- Endpoints ---

export async function getCenters(): Promise<ZenotiCenter[]> {
    const data = await zenotiCall<{ centers: ZenotiCenter[] }>('GET', '/v1/centers');
    return data.centers || [];
}

/** Add `days` to a YYYY-MM-DD date, returning YYYY-MM-DD (UTC-safe). */
function addDays(date: string, days: number): string {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

/**
 * Fetch appointments for a date range (YYYY-MM-DD, INCLUSIVE of both ends)
 * across the given locations (default: all three). Handles the 7-day window cap
 * and tags each record with its location. Calls run sequentially to respect the
 * 60/min org limit.
 *
 * ⚠️ Zenoti's /v1/appointments `end_date` is EXCLUSIVE (verified 2026-07-06:
 * `7/1..7/2` returns only 7/1; `7/1..7/1` returns nothing). To honor an
 * inclusive contract we query each chunk with `end_date = chunkEnd + 1 day`.
 * (The sales flat_file endpoint is the opposite — inclusive, datetime-based.)
 */
export async function getZenotiAppointments(
    startDate: string,
    endDate: string,
    locations: ZenotiLocationKey[] = ZENOTI_LOCATIONS
): Promise<ZenotiAppointment[]> {
    const chunks = chunkDateRange(startDate, endDate);
    const all: ZenotiAppointment[] = [];

    for (const location of locations) {
        const centerId = getCenterId(location);
        for (const { start, end } of chunks) {
            const apiEnd = addDays(end, 1); // exclusive end → +1 to include `end`
            const data = await zenotiCall<Omit<ZenotiAppointment, 'location' | 'center_id'>[]>(
                'GET',
                // include_no_show_cancel: without it Zenoti omits cancelled (-1) and
                // no-show (-2) rows entirely, so a cancelled booking stays frozen at
                // 'Booked'/'Confirmed' in mb_appointments_history forever (verified
                // 2026-07-15: 85 stale rows in the 7/1–7/14 window).
                `/v1/appointments?center_id=${centerId}&start_date=${start}&end_date=${apiEnd}&include_no_show_cancel=true`
            );
            for (const appt of data || []) {
                all.push({ ...appt, location, center_id: centerId });
            }
        }
    }

    return all;
}

/**
 * Fetch every Zenoti sales flat_file row for a date range across the given
 * centers, paginated. Accepts "YYYY-MM-DD" or a full datetime (sliced to a date).
 */
export async function fetchZenotiSalesRows(
    startDate: string,
    endDate: string,
    locations: ZenotiLocationKey[] = ZENOTI_LOCATIONS,
): Promise<ZenotiSalesRow[]> {
    const rows: ZenotiSalesRow[] = [];
    const start = startDate.slice(0, 10);
    const end = endDate.slice(0, 10);

    for (const location of locations) {
        const centerId = getCenterId(location);
        let page = 1;
        for (;;) {
            const res = await zenotiCall<{
                sales: ZenotiSalesRow[] | null;
                page_info?: { total: number } | null;
            }>('POST', `/v1/reports/sales/accrual_basis/flat_file?page=${page}&size=100`, {
                center_ids: [centerId],
                start_date: `${start} 00:00:00`,
                end_date: `${end} 23:59:59`,
            });
            const batch = res.sales ?? [];
            rows.push(...batch);
            const total = res.page_info?.total ?? batch.length;
            if (batch.length === 0 || page * 100 >= total) break;
            page += 1;
        }
    }
    return rows;
}

// --- Guest lookup (for phone/email → identity merge) ---

interface ZenotiGuestSearchRaw {
    id: string;
    personal_info: {
        first_name: string;
        last_name: string;
        email: string | null;
        mobile_phone: { number: string | null } | null;
    } | null;
}

export interface ZenotiGuestHit {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
}

/** Fetch a single guest by GUID. Returns null on 404/error. */
export async function getZenotiGuest(guestId: string): Promise<ZenotiGuestHit | null> {
    const g = await zenotiCall<ZenotiGuestSearchRaw>('GET', `/v1/guests/${guestId}`)
        .catch(() => null);
    if (!g?.id) return null;
    return {
        id: g.id,
        firstName: g.personal_info?.first_name ?? '',
        lastName: g.personal_info?.last_name ?? '',
        email: g.personal_info?.email || null,
        phone: g.personal_info?.mobile_phone?.number || null,
    };
}
