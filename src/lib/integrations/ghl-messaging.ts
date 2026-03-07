/**
 * GHL v2 Messaging — SMS sending for re-activation campaigns
 * Uses conversations/message.write scope via Private Integration Tokens
 *
 * Rate limits: 100 req/10s burst, 200K/day
 * Sends via GHL's own SMS infrastructure (Twilio/LC Phone under the hood)
 */

import { trackCall } from '@/lib/api-usage-tracker';
import { type LocationKey } from '@/lib/integrations/gohighlevel';

const GHL_V2_BASE = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = '2021-07-28';

export interface SMSResult {
    contactId: string;
    contactName: string;
    success: boolean;
    messageId?: string;
    error?: string;
}

export interface BulkSMSResult {
    results: SMSResult[];
    sent: number;
    failed: number;
    skipped: number;
}

interface V2LocationConfig {
    locationId: string;
    pit: string;
}

function getV2Config(locationKey: LocationKey): V2LocationConfig | null {
    const envMap: Record<LocationKey, { envId: string; envPit: string }> = {
        decatur: { envId: 'GHL_LOCATION_ID_DECATUR', envPit: 'GHL_PIT_DECATUR' },
        smyrna: { envId: 'GHL_LOCATION_ID_SMYRNA', envPit: 'GHL_PIT_SMYRNA' },
        kennesaw: { envId: 'GHL_LOCATION_ID_KENNESAW', envPit: 'GHL_PIT_KENNESAW' },
    };
    const config = envMap[locationKey];
    if (!config) return null;
    const locationId = process.env[config.envId];
    const pit = process.env[config.envPit];
    if (!locationId || !pit) return null;
    return { locationId, pit };
}

/**
 * Send a single SMS via GHL v2 Conversations API
 * POST /conversations/messages
 */
export async function sendSMS(
    locationId: string,
    pit: string,
    contactId: string,
    message: string,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
        const res = await fetch(`${GHL_V2_BASE}/conversations/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${pit}`,
                'Version': GHL_API_VERSION,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify({
                type: 'SMS',
                contactId,
                message,
            }),
        });
        trackCall('ghl', 'sendSMS', false);

        if (res.ok) {
            const data = await res.json();
            return { success: true, messageId: data.messageId || data.id };
        } else {
            const text = await res.text();
            return { success: false, error: `${res.status}: ${text.slice(0, 150)}` };
        }
    } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
}

/**
 * Template variable substitution
 */
export function renderTemplate(
    template: string,
    vars: { firstName?: string; locationName?: string; lastService?: string },
): string {
    let rendered = template;
    rendered = rendered.replace(/\{\{firstName\}\}/g, vars.firstName || 'there');
    rendered = rendered.replace(/\{\{locationName\}\}/g, vars.locationName || 'Chin Up!');
    rendered = rendered.replace(/\{\{lastService\}\}/g, vars.lastService || 'your treatment');
    return rendered;
}

/**
 * DND / opt-out check
 */
export function isDNDContact(tags: string[], phone?: string): boolean {
    if (!phone) return true; // No phone = can't send
    return tags.some(t => /dnd|do.not.disturb|opted.out|unsubscribe/i.test(t));
}

/**
 * Send bulk SMS with throttling (5 per second to stay under rate limits)
 */
export async function sendBulkSMS(
    locationKey: LocationKey,
    contacts: {
        contactId: string;
        contactName: string;
        firstName: string;
        phone: string;
        tags: string[];
    }[],
    messageTemplate: string,
    locationName: string,
): Promise<BulkSMSResult> {
    const config = getV2Config(locationKey);
    if (!config) {
        return {
            results: contacts.map(c => ({ contactId: c.contactId, contactName: c.contactName, success: false, error: 'Location not configured' })),
            sent: 0, failed: contacts.length, skipped: 0,
        };
    }

    const results: SMSResult[] = [];
    let sent = 0, failed = 0, skipped = 0;

    for (let i = 0; i < contacts.length; i++) {
        const contact = contacts[i];

        // Skip DND contacts
        if (isDNDContact(contact.tags, contact.phone)) {
            results.push({ contactId: contact.contactId, contactName: contact.contactName, success: false, error: 'DND/opted-out or no phone' });
            skipped++;
            continue;
        }

        // Render message
        const message = renderTemplate(messageTemplate, {
            firstName: contact.firstName,
            locationName,
        });

        const result = await sendSMS(config.locationId, config.pit, contact.contactId, message);
        results.push({
            contactId: contact.contactId,
            contactName: contact.contactName,
            ...result,
        });

        if (result.success) sent++;
        else failed++;

        // Throttle: 200ms delay = 5 per second
        if (i < contacts.length - 1) {
            await new Promise(r => setTimeout(r, 200));
        }
    }

    return { results, sent, failed, skipped };
}

/**
 * Pre-built SMS templates
 */
export const SMS_TEMPLATES = {
    'reactivation': {
        label: 'Re-activation (Stale)',
        template: "Hi {{firstName}}, it's been a while since we've seen you at Chin Up! We'd love to welcome you back. Reply DELETE to opt out.",
    },
    'winback': {
        label: 'Win-back (Dormant)',
        template: "Hi {{firstName}}, we miss you at Chin Up! Aesthetics. We have a special offer just for returning clients \u2014 reply YES to learn more. Reply DELETE to opt out.",
    },
    'followup': {
        label: 'Follow-up (At-risk)',
        template: "Hi {{firstName}}, just checking in! We noticed you had an inquiry with us. Would you like to schedule? Reply DELETE to opt out.",
    },
    'lapsed-patient': {
        label: 'Lapsed Patient',
        template: "Hi {{firstName}}, we miss seeing you at Chin Up! {{locationName}}! It's been a while since your last visit. We'd love to have you back \u2014 reply YES to book. Reply DELETE to opt out.",
    },
    'lapsed-vip': {
        label: 'Lapsed VIP Patient',
        template: "Hi {{firstName}}, as one of our valued patients at Chin Up!, we wanted to reach out personally. We have some exciting new treatments and would love to see you again. Reply YES to learn more. Reply DELETE to opt out.",
    },
};
