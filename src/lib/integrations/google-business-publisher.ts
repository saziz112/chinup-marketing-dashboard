/**
 * Google Business Profile Publisher
 * Posts to GBP for all 3 Chin Up locations via GoHighLevel v2 Social Planner API.
 * GHL acts as intermediary — it has approved Google API access for GBP posting.
 */

const GHL_V2_BASE = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = '2021-07-28';

const GBP_LOCATIONS: Record<string, {
    name: string;
    pitEnvKey: string;
    ghlLocationEnvKey: string;
    gbpAccountEnvKey: string;
}> = {
    decatur: {
        name: 'Decatur',
        pitEnvKey: 'GHL_PIT_DECATUR',
        ghlLocationEnvKey: 'GHL_LOCATION_ID_DECATUR',
        gbpAccountEnvKey: 'GHL_GBP_ACCOUNT_DECATUR',
    },
    smyrna: {
        name: 'Smyrna/Vinings',
        pitEnvKey: 'GHL_PIT_SMYRNA',
        ghlLocationEnvKey: 'GHL_LOCATION_ID_SMYRNA',
        gbpAccountEnvKey: 'GHL_GBP_ACCOUNT_SMYRNA',
    },
    kennesaw: {
        name: 'Kennesaw',
        pitEnvKey: 'GHL_PIT_KENNESAW',
        ghlLocationEnvKey: 'GHL_LOCATION_ID_KENNESAW',
        gbpAccountEnvKey: 'GHL_GBP_ACCOUNT_KENNESAW',
    },
};

export function isGBPConfigured(): boolean {
    // Need at least one location with PIT + GBP account ID
    return Object.values(GBP_LOCATIONS).some(config =>
        process.env[config.pitEnvKey] &&
        process.env[config.ghlLocationEnvKey] &&
        process.env[config.gbpAccountEnvKey] &&
        process.env.GHL_USER_ID
    );
}

export function getConfiguredLocations(): { key: string; name: string; locationId: string }[] {
    return Object.entries(GBP_LOCATIONS)
        .filter(([, config]) =>
            process.env[config.pitEnvKey] &&
            process.env[config.ghlLocationEnvKey] &&
            process.env[config.gbpAccountEnvKey]
        )
        .map(([key, config]) => ({
            key,
            name: config.name,
            locationId: process.env[config.ghlLocationEnvKey]!,
        }));
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
            error: 'Google Business Profile not configured — add GHL v2 PIT tokens',
            locationKey: key,
            locationName: GBP_LOCATIONS[key]?.name || key,
        }));
    }

    const userId = process.env.GHL_USER_ID!;

    const tasks = locationKeys.map(async (key): Promise<GBPPublishResult> => {
        const config = GBP_LOCATIONS[key];
        if (!config) {
            return { success: false, error: `Unknown location: ${key}`, locationKey: key, locationName: key };
        }

        const pit = process.env[config.pitEnvKey];
        const ghlLocationId = process.env[config.ghlLocationEnvKey];
        const gbpAccountId = process.env[config.gbpAccountEnvKey];

        if (!pit || !ghlLocationId || !gbpAccountId) {
            return { success: false, error: `Location ${config.name} not fully configured`, locationKey: key, locationName: config.name };
        }

        try {
            const media: { url: string; type: string }[] = [];
            if (mediaUrl) {
                media.push({ url: mediaUrl, type: 'image/jpeg' });
            }

            const body: Record<string, unknown> = {
                accountIds: [gbpAccountId],
                userId,
                type: 'post',
                summary,
                media,
                gmbPostDetails: {
                    gmbEventType: 'STANDARD',
                    actionType: 'learn_more',
                    url: 'https://chinupaesthetics.com',
                },
            };

            const url = `${GHL_V2_BASE}/social-media-posting/${ghlLocationId}/posts`;
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${pit}`,
                    'Version': GHL_API_VERSION,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
            });

            if (!res.ok) {
                const errText = await res.text();
                console.error(`[GBP] Failed to post to ${config.name}:`, errText);
                return { success: false, error: `GHL API error: ${res.status} ${errText.slice(0, 200)}`, locationKey: key, locationName: config.name };
            }

            const data = await res.json();
            const postId = data.postId || data.id || data.results?.id;
            console.log(`[GBP] Posted to ${config.name}:`, postId);
            return { success: true, postId, locationKey: key, locationName: config.name };
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Unknown error';
            return { success: false, error: msg, locationKey: key, locationName: config.name };
        }
    });

    return Promise.all(tasks);
}
