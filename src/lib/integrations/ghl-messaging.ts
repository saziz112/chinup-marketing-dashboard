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
    vars: { firstName?: string; locationName?: string; lastService?: string; serviceName?: string },
): string {
    let rendered = template;
    rendered = rendered.replace(/\{\{firstName\}\}/g, vars.firstName || 'there');
    rendered = rendered.replace(/\{\{locationName\}\}/g, vars.locationName || 'Chin Up!');
    rendered = rendered.replace(/\{\{lastService\}\}/g, vars.lastService || 'your treatment');
    rendered = rendered.replace(/\{\{serviceName\}\}/g, vars.serviceName || 'your appointment');
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
export const SMS_TEMPLATES: Record<string, { label: string; template: string }> = {
    'cancelled': {
        label: "Let's Reschedule",
        template: "Hi {{firstName}}, we noticed you had to reschedule your appointment at Chin Up! We totally understand \u2014 life happens. We'd love to get you rebooked whenever you're ready. Reply YES to schedule. Reply STOP to opt out.",
    },
    'engaged': {
        label: 'Ready to Book?',
        template: "Hi {{firstName}}, we chatted recently and wanted to follow up! Would you like to schedule your consultation at Chin Up? Reply YES to book. Reply STOP to opt out.",
    },
    'consult-only': {
        label: "We'd Love to See You",
        template: "Hi {{firstName}}, thanks for coming in for your consultation at Chin Up! We'd love to help you take the next step. Reply YES if you'd like to schedule your treatment. Reply STOP to opt out.",
    },
    'lapsed-recent': {
        label: 'Time for a Refresh',
        template: "Hi {{firstName}}, it's been a little while since your last visit at Chin Up! {{locationName}}. Ready for a refresh? Reply YES to book. Reply STOP to opt out.",
    },
    'ghost': {
        label: 'Still Thinking?',
        template: "Hi {{firstName}}, you were interested in treatments at Chin Up! Just wanted to follow up \u2014 we'd love to help you get started. Reply YES for our current availability. Reply STOP to opt out.",
    },
    'lapsed-vip': {
        label: 'VIP Welcome Back',
        template: "Hi {{firstName}}, as one of our valued patients at Chin Up!, we wanted to personally invite you back. We've added exciting new treatments \u2014 reply YES to learn more. Reply STOP to opt out.",
    },
    'pipeline-followup': {
        label: 'Quick Follow-Up',
        template: "Hi {{firstName}}, just following up on your inquiry with Chin Up! Would you like to schedule a consultation? Reply YES and we'll get you booked. Reply STOP to opt out.",
    },
    'untouched': {
        label: 'We Dropped the Ball',
        template: "Hi {{firstName}}, thanks for your interest in Chin Up! Aesthetics. We apologize for the delayed follow-up. We'd still love to help \u2014 would you like to schedule a consultation? Reply YES to book. Reply STOP to opt out.",
    },
    'lapsed-long': {
        label: 'We Miss You',
        template: "Hi {{firstName}}, it's been a while! We'd love to welcome you back to Chin Up! with something special for returning patients. Reply YES for details. Reply STOP to opt out.",
    },
};
