/**
 * Mindbody API v6 Client
 * Handles authentication, token renewal, and data fetching.
 * Ported from Monthly Bonus Dashboard with referral source extraction.
 */

import { trackCall } from '@/lib/api-usage-tracker';

// --- Types ---

export interface MindbodyToken {
    accessToken: string;
    expires: string;
    issuedAt: number;
}

export interface PurchasedItem {
    SaleDetailId: number;
    Id: number;
    IsService: boolean;
    BarcodeId: string;
    Description: string;
    CategoryId: number;
    SubCategoryId: number;
    UnitPrice: number;
    Quantity: number;
    DiscountPercent: number;
    DiscountAmount: number;
    TaxAmount: number;
    TotalAmount: number;
    Returned: boolean;
}

export interface Sale {
    Id: number;
    SaleDate: string;
    SaleTime: string;
    SaleDateTime: string;
    SalesRepId: number;
    ClientId: string;
    LocationId: number;
    PurchasedItems: PurchasedItem[];
    Payments: { Id: number; Amount: number; Type: string }[];
}

export interface Client {
    Id: string;
    FirstName: string;
    LastName: string;
    Email?: string;
    MobilePhone?: string;
    HomePhone?: string;
    ReferredBy?: string;
    ReferralSource?: string;
    FirstAppointmentDate?: string;
    CreationDate?: string;
}

export interface StaffAppointment {
    Id: number;
    StaffId: number;
    Staff: { Id: number; FirstName: string; LastName: string; DisplayName: string };
    StartDateTime: string;
    EndDateTime: string;
    Duration: number;
    Status: string;
    LocationId: number;
    SessionTypeId: number;
    SessionType?: { Id: number; Name: string };
    FirstAppointment: boolean;
    ClientId: string;
    Client?: { Id: string; FirstName: string; LastName: string };
    Notes?: string;
}

// --- Token Management ---

let cachedToken: MindbodyToken | null = null;

function getEnv(key: string): string {
    const val = process.env[key];
    if (!val) throw new Error(`Missing env var: ${key}`);
    return val;
}

export async function apiCall<T>(
    method: 'GET' | 'POST',
    endpoint: string,
    body?: Record<string, unknown>,
    token?: string
): Promise<T> {
    const headers: Record<string, string> = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Api-Key': getEnv('MINDBODY_API_KEY'),
        'SiteId': getEnv('MINDBODY_SITE_ID'),
    };
    if (token) {
        headers['authorization'] = `Bearer ${token}`;
    }

    const options: RequestInit = { method, headers };
    if (body) {
        options.body = JSON.stringify(body);
    }

    const url = `${getEnv('MINDBODY_BASE_URL')}${endpoint}`;
    const response = await fetch(url, options);
    trackCall('mindbody', endpoint.split('?')[0], false);

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
            `Mindbody API error: ${response.status} ${endpoint} — ${JSON.stringify(errorData)}`
        );
    }

    return response.json() as Promise<T>;
}

export async function getToken(): Promise<string> {
    if (cachedToken) {
        const expiresAt = new Date(cachedToken.expires).getTime();
        const bufferMs = 5 * 60 * 1000;
        if (Date.now() < expiresAt - bufferMs) {
            return cachedToken.accessToken;
        }
        try {
            const renewed = await apiCall<{ AccessToken: string; Expires: string }>(
                'POST',
                '/usertoken/renew',
                undefined,
                cachedToken.accessToken
            );
            cachedToken = {
                accessToken: renewed.AccessToken,
                expires: renewed.Expires || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                issuedAt: Date.now(),
            };
            return cachedToken.accessToken;
        } catch {
            // Renewal failed, fall through to fresh token
        }
    }

    const data = await apiCall<{ AccessToken: string; Expires: string }>(
        'POST',
        '/usertoken/issue',
        {
            Username: getEnv('MINDBODY_USERNAME'),
            Password: getEnv('MINDBODY_PASSWORD'),
        }
    );

    cachedToken = {
        accessToken: data.AccessToken,
        expires: data.Expires,
        issuedAt: Date.now(),
    };

    return cachedToken.accessToken;
}

// --- Data Fetching ---

export async function getSales(startDate: string, endDate: string): Promise<Sale[]> {
    const token = await getToken();
    const allSales: Sale[] = [];
    let offset = 0;
    const limit = 100;

    while (true) {
        const data = await apiCall<{ Sales: Sale[] }>(
            'GET',
            `/sale/sales?StartSaleDateTime=${startDate}&EndSaleDateTime=${endDate}&Limit=${limit}&Offset=${offset}`,
            undefined,
            token
        );
        const sales = data.Sales || [];
        allSales.push(...sales);
        if (sales.length < limit) break;
        offset += limit;
    }

    return allSales;
}

export async function getAppointments(
    startDate: string,
    endDate: string
): Promise<StaffAppointment[]> {
    const token = await getToken();
    const allAppointments: StaffAppointment[] = [];
    let offset = 0;
    const limit = 100;

    while (true) {
        const data = await apiCall<{ StaffAppointments?: StaffAppointment[]; Appointments?: StaffAppointment[] }>(
            'GET',
            `/appointment/staffappointments?StartDate=${startDate}&EndDate=${endDate}&Limit=${limit}&Offset=${offset}`,
            undefined,
            token
        );
        const appts = data.StaffAppointments || data.Appointments || [];
        allAppointments.push(...appts);
        if (appts.length < limit) break;
        offset += limit;
    }

    return allAppointments;
}

/**
 * Fetch client details including referral source for attribution.
 */
export async function getClients(clientIds: string[]): Promise<Client[]> {
    if (clientIds.length === 0) return [];

    const token = await getToken();
    const allClients: Client[] = [];

    // MindBody API rejects batches >20 client IDs with HTTP 400
    const chunkSize = 10;
    for (let i = 0; i < clientIds.length; i += chunkSize) {
        const chunk = clientIds.slice(i, i + chunkSize);
        try {
            const queryParams = chunk.map(id => `ClientIds=${id}`).join('&');
            const data = await apiCall<{ Clients: Client[] }>(
                'GET',
                `/client/clients?${queryParams}`,
                undefined,
                token
            );
            if (data.Clients) allClients.push(...data.Clients);
        } catch (e) {
            console.error('Failed to fetch clients chunk', e);
        }
    }
    return allClients;
}

/**
 * Get all purchasing clients within a date range with their referral data.
 *
 * Strategy: MindBody's client endpoint ignores date filters (returns all 13K+
 * clients). Instead, we use a sales-based approach:
 * 1. Get all sales in the date range (date filter works on sales endpoint)
 * 2. Extract unique client IDs from sales
 * 3. Fetch those specific clients for ReferredBy + CreationDate
 *
 * Results are cached for 4 hours to minimize API calls (~50 calls per fresh fetch).
 * MindBody free tier: 5,000 calls/month. With 4h cache, worst case = 6 refreshes/day
 * = ~300 calls/day = well within budget.
 */
export async function getPurchasingClients(startDate: string, endDate: string): Promise<{
    clients: Client[];
    sales: Sale[];
}> {
    // Check in-memory cache first (keyed by date range)
    const cacheKey = `purchasing_${startDate}_${endDate}`;
    const cached = purchasingClientsCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
        trackCall('mindbody', 'getPurchasingClients', true);
        return cached.data;
    }

    const sales = await getSales(startDate, endDate);
    const clientIds = [...new Set(sales.map(s => s.ClientId).filter(Boolean))];

    if (clientIds.length === 0) return { clients: [], sales };

    const clients = await getClients(clientIds);
    const result = { clients, sales };

    // Cache for 4 hours
    purchasingClientsCache.set(cacheKey, {
        data: result,
        expiresAt: Date.now() + 4 * 60 * 60 * 1000,
    });

    return result;
}

// In-memory cache for purchasing clients (avoids duplicate API calls)
const purchasingClientsCache = new Map<string, {
    data: { clients: Client[]; sales: Sale[] };
    expiresAt: number;
}>();

/**
 * Get new clients within a date range (for lead attribution).
 * Convenience wrapper that filters getPurchasingClients to only new clients.
 */
export async function getNewClients(startDate: string, endDate: string): Promise<Client[]> {
    const { clients } = await getPurchasingClients(startDate, endDate);

    const startMs = new Date(startDate).getTime();
    const endMs = new Date(endDate).getTime();

    return clients.filter(c => {
        if (!c.CreationDate) return false;
        const created = new Date(c.CreationDate).getTime();
        return created >= startMs && created <= endMs;
    });
}

/** Normalize phone: strip non-digits, take last 10 digits */
export function normalizePhone(raw: string): string {
    const digits = raw.replace(/\D/g, '');
    return digits.length >= 10 ? digits.slice(-10) : digits;
}

type ClientRevenue = { client: Client; revenue: number };

/**
 * Build email → {client, revenue} and phone → {client, revenue} maps
 * from purchasing clients. Used for attribution matching against GHL leads.
 */
export async function getClientMatchMaps(
    startDate: string,
    endDate: string
): Promise<{ emailMap: Map<string, ClientRevenue>; phoneMap: Map<string, ClientRevenue>; nameMap: Map<string, ClientRevenue> }> {
    const { clients, sales } = await getPurchasingClients(startDate, endDate);

    // Build clientId → revenue map from sales
    const revenueByClient = new Map<string, number>();
    for (const sale of sales) {
        const total = sale.PurchasedItems?.reduce((s, i) => s + (i.TotalAmount || 0), 0) || 0;
        revenueByClient.set(sale.ClientId, (revenueByClient.get(sale.ClientId) || 0) + total);
    }

    const emailMap = new Map<string, ClientRevenue>();
    const phoneMap = new Map<string, ClientRevenue>();
    const nameMap = new Map<string, ClientRevenue>();
    const nameCollisions = new Set<string>();

    for (const client of clients) {
        const entry: ClientRevenue = {
            client,
            revenue: revenueByClient.get(client.Id) || 0,
        };

        // Email map
        if (client.Email) {
            const email = client.Email.toLowerCase().trim();
            if (email) emailMap.set(email, entry);
        }

        // Phone map (try MobilePhone first, then HomePhone)
        for (const raw of [client.MobilePhone, client.HomePhone]) {
            if (!raw) continue;
            const phone = normalizePhone(raw);
            if (phone.length === 10 && !phoneMap.has(phone)) {
                phoneMap.set(phone, entry);
            }
        }

        // Name map (fallback for cases where email/phone differ between systems)
        if (client.FirstName && client.LastName) {
            const nameKey = `${client.FirstName.toLowerCase().trim()} ${client.LastName.toLowerCase().trim()}`;
            if (nameMap.has(nameKey)) {
                nameCollisions.add(nameKey); // Ambiguous — will be removed
            } else {
                nameMap.set(nameKey, entry);
            }
        }
    }

    // Remove ambiguous names (multiple clients share the same name)
    for (const name of nameCollisions) {
        nameMap.delete(name);
    }

    return { emailMap, phoneMap, nameMap };
}

/** @deprecated Use getClientMatchMaps instead */
export async function getClientEmailMap(
    startDate: string,
    endDate: string
): Promise<Map<string, ClientRevenue>> {
    const { emailMap } = await getClientMatchMaps(startDate, endDate);
    return emailMap;
}
