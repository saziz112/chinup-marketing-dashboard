/**
 * Google Business Profile Publisher
 * Posts to GBP for all 3 Chin Up locations.
 * Reuses the same Google Cloud project as Google Ads (same client ID/secret).
 */

const GBP_LOCATIONS: Record<string, { name: string; envKey: string }> = {
    decatur: { name: 'Decatur', envKey: 'GOOGLE_BUSINESS_LOCATION_DECATUR' },
    smyrna: { name: 'Smyrna/Vinings', envKey: 'GOOGLE_BUSINESS_LOCATION_SMYRNA' },
    kennesaw: { name: 'Kennesaw', envKey: 'GOOGLE_BUSINESS_LOCATION_KENNESAW' },
};

export function isGBPConfigured(): boolean {
    return Boolean(
        process.env.GOOGLE_ADS_CLIENT_ID &&
        process.env.GOOGLE_ADS_CLIENT_SECRET &&
        process.env.GOOGLE_BUSINESS_REFRESH_TOKEN &&
        process.env.GOOGLE_BUSINESS_ACCOUNT_ID
    );
}

export function getConfiguredLocations(): { key: string; name: string; locationId: string }[] {
    return Object.entries(GBP_LOCATIONS)
        .filter(([, config]) => process.env[config.envKey])
        .map(([key, config]) => ({
            key,
            name: config.name,
            locationId: process.env[config.envKey]!,
        }));
}

async function getAccessToken(): Promise<string> {
    const params = new URLSearchParams({
        client_id: process.env.GOOGLE_ADS_CLIENT_ID!,
        client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET!,
        refresh_token: process.env.GOOGLE_BUSINESS_REFRESH_TOKEN!,
        grant_type: 'refresh_token',
    });

    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        cache: 'no-store',
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`GBP token refresh failed: ${text}`);
    }

    const data = await res.json();
    return data.access_token;
}

export interface GBPPublishResult {
    success: boolean;
    postId?: string;
    error?: string;
    locationKey: string;
    locationName: string;
}

export async function publishToGoogleBusiness(
    summary: string,
    locationKeys: string[],
    mediaUrl?: string,
): Promise<GBPPublishResult[]> {
    if (!isGBPConfigured()) {
        return locationKeys.map(key => ({
            success: false,
            error: 'Google Business Profile not configured',
            locationKey: key,
            locationName: GBP_LOCATIONS[key]?.name || key,
        }));
    }

    const accountId = process.env.GOOGLE_BUSINESS_ACCOUNT_ID!;
    const accessToken = await getAccessToken();

    const tasks = locationKeys.map(async (key): Promise<GBPPublishResult> => {
        const config = GBP_LOCATIONS[key];
        if (!config) {
            return { success: false, error: `Unknown location: ${key}`, locationKey: key, locationName: key };
        }

        const locationId = process.env[config.envKey];
        if (!locationId) {
            return { success: false, error: `Location ${config.name} not configured`, locationKey: key, locationName: config.name };
        }

        try {
            const body: Record<string, unknown> = {
                languageCode: 'en-US',
                summary,
                topicType: 'STANDARD',
            };

            if (mediaUrl) {
                body.media = [{
                    mediaFormat: 'PHOTO',
                    sourceUrl: mediaUrl,
                }];
            }

            const url = `https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locationId}/localPosts`;
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
            });

            if (!res.ok) {
                const errText = await res.text();
                console.error(`[GBP] Failed to post to ${config.name}:`, errText);
                return { success: false, error: `API error: ${res.status} ${errText.slice(0, 200)}`, locationKey: key, locationName: config.name };
            }

            const data = await res.json();
            const postId = data.name?.split('/').pop() || data.name;
            return { success: true, postId, locationKey: key, locationName: config.name };
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Unknown error';
            return { success: false, error: msg, locationKey: key, locationName: config.name };
        }
    });

    return Promise.all(tasks);
}
