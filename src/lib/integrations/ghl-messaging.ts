/**
 * GHL v2 Messaging — SMS + Email sending for re-activation campaigns
 * Uses conversations/message.write scope via Private Integration Tokens
 *
 * Rate limits: 100 req/10s burst, 200K/day
 * Sends via GHL's own infrastructure (Twilio/LC Phone for SMS, SMTP for Email)
 */

import { trackCall } from '@/lib/api-usage-tracker';
import { type LocationKey } from '@/lib/integrations/gohighlevel';
import { checkDNDSimple } from '@/lib/dnd-check';

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

/* ── Send Single SMS ─────────────────────────────────────── */

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

/* ── Send Single Email ───────────────────────────────────── */

export async function sendEmail(
    locationId: string,
    pit: string,
    contactId: string,
    htmlBody: string,
    subject: string,
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
                type: 'Email',
                contactId,
                html: htmlBody,
                subject,
            }),
        });
        trackCall('ghl', 'sendEmail', false);

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

/* ── Template Rendering ──────────────────────────────────── */

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

/* ── DND Check (backward compat — prefer checkDNDSimple from dnd-check.ts) ── */

export function isDNDContact(tags: string[], phone?: string): boolean {
    return checkDNDSimple(false, tags, 'sms', phone);
}

/* ── Bulk SMS ────────────────────────────────────────────── */

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

        if (isDNDContact(contact.tags, contact.phone)) {
            results.push({ contactId: contact.contactId, contactName: contact.contactName, success: false, error: 'DND/opted-out or no phone' });
            skipped++;
            continue;
        }

        const message = renderTemplate(messageTemplate, {
            firstName: contact.firstName,
            locationName,
        });

        const result = await sendSMS(config.locationId, config.pit, contact.contactId, message);
        results.push({ contactId: contact.contactId, contactName: contact.contactName, ...result });

        if (result.success) sent++;
        else failed++;

        // 200ms delay = 5 per second
        if (i < contacts.length - 1) await new Promise(r => setTimeout(r, 200));
    }

    return { results, sent, failed, skipped };
}

/* ── Bulk Email (1 per second throttle for domain warmth) ── */

export async function sendBulkEmail(
    locationKey: LocationKey,
    contacts: {
        contactId: string;
        contactName: string;
        firstName: string;
        email: string;
        tags: string[];
    }[],
    messageTemplate: string,
    locationName: string,
    subject: string,
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

        if (!contact.email) {
            results.push({ contactId: contact.contactId, contactName: contact.contactName, success: false, error: 'No email address' });
            skipped++;
            continue;
        }

        if (checkDNDSimple(false, contact.tags, 'email', contact.email)) {
            results.push({ contactId: contact.contactId, contactName: contact.contactName, success: false, error: 'DND/opted-out' });
            skipped++;
            continue;
        }

        const message = renderTemplate(messageTemplate, {
            firstName: contact.firstName,
            locationName,
        });

        const result = await sendEmail(config.locationId, config.pit, contact.contactId, message, subject);
        results.push({ contactId: contact.contactId, contactName: contact.contactName, ...result });

        if (result.success) sent++;
        else failed++;

        // 1 second delay for email domain warmth protection
        if (i < contacts.length - 1) await new Promise(r => setTimeout(r, 1000));
    }

    return { results, sent, failed, skipped };
}

/* ── Contact Search (for test sends) ─────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractContact(data: any): { contactId: string; contactName: string } | null {
    // GHL responses vary — try common shapes
    const contact = data?.contact || data?.contacts?.[0] || data;
    const id = contact?.id as string;
    if (!id) return null;
    const name = (contact.contactName || contact.name || `${contact.firstName || ''} ${contact.lastName || ''}`.trim()) as string;
    return { contactId: id, contactName: name || 'Unknown' };
}

export async function searchContactByPhone(
    pit: string,
    phone: string,
    locationId?: string,
): Promise<{ contactId: string; contactName: string } | null> {
    const digits = phone.replace(/\D/g, '');
    const e164 = digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith('1') ? `+${digits}` : `+${digits}`;
    const headers = {
        'Authorization': `Bearer ${pit}`,
        'Version': GHL_API_VERSION,
        'Accept': 'application/json',
    };

    // Strategy 1: v2 contacts/lookup (most reliable)
    if (locationId) {
        try {
            const res = await fetch(`${GHL_V2_BASE}/contacts/lookup?phone=${encodeURIComponent(e164)}&locationId=${locationId}`, { headers });
            trackCall('ghl', 'searchContactByPhone-lookup', false);
            if (res.ok) {
                const data = await res.json();
                const found = extractContact(data);
                if (found) return found;
            }
        } catch { /* fall through */ }
    }

    // Strategy 2: v2 contacts search with query param
    if (locationId) {
        try {
            const res = await fetch(`${GHL_V2_BASE}/contacts/?locationId=${locationId}&query=${digits}&limit=1`, { headers });
            trackCall('ghl', 'searchContactByPhone-search', false);
            if (res.ok) {
                const data = await res.json();
                const contacts = data.contacts as Array<Record<string, unknown>> | undefined;
                if (contacts?.[0]?.id) {
                    return extractContact(contacts[0]);
                }
            }
        } catch { /* fall through */ }
    }

    // Strategy 3: duplicate search (original approach, fallback)
    try {
        const params = new URLSearchParams({ number: digits });
        if (locationId) params.set('locationId', locationId);
        const res = await fetch(`${GHL_V2_BASE}/contacts/search/duplicate?${params}`, { headers });
        trackCall('ghl', 'searchContactByPhone-duplicate', false);
        if (res.ok) {
            const data = await res.json();
            return extractContact(data);
        }
    } catch { /* fall through */ }

    return null;
}

export async function searchContactByEmail(
    pit: string,
    email: string,
    locationId?: string,
): Promise<{ contactId: string; contactName: string } | null> {
    const headers = {
        'Authorization': `Bearer ${pit}`,
        'Version': GHL_API_VERSION,
        'Accept': 'application/json',
    };

    // Strategy 1: v2 contacts/lookup
    if (locationId) {
        try {
            const res = await fetch(`${GHL_V2_BASE}/contacts/lookup?email=${encodeURIComponent(email)}&locationId=${locationId}`, { headers });
            trackCall('ghl', 'searchContactByEmail-lookup', false);
            if (res.ok) {
                const data = await res.json();
                const found = extractContact(data);
                if (found) return found;
            }
        } catch { /* fall through */ }
    }

    // Strategy 2: v2 contacts search with query param
    if (locationId) {
        try {
            const res = await fetch(`${GHL_V2_BASE}/contacts/?locationId=${locationId}&query=${encodeURIComponent(email)}&limit=1`, { headers });
            trackCall('ghl', 'searchContactByEmail-search', false);
            if (res.ok) {
                const data = await res.json();
                const contacts = data.contacts as Array<Record<string, unknown>> | undefined;
                if (contacts?.[0]?.id) {
                    return extractContact(contacts[0]);
                }
            }
        } catch { /* fall through */ }
    }

    // Strategy 3: duplicate search (fallback)
    try {
        const params = new URLSearchParams({ email });
        if (locationId) params.set('locationId', locationId);
        const res = await fetch(`${GHL_V2_BASE}/contacts/search/duplicate?${params}`, { headers });
        trackCall('ghl', 'searchContactByEmail-duplicate', false);
        if (res.ok) {
            const data = await res.json();
            return extractContact(data);
        }
    } catch { /* fall through */ }

    return null;
}

/* ── SMS Templates (6 campaigns) ─────────────────────────── */

export const SMS_TEMPLATES: Record<string, { label: string; template: string }> = {
    'cancelled': {
        label: "Let's Reschedule",
        template: "Hi {{firstName}}, we noticed you had to reschedule your appointment at Chin Up! We totally understand \u2014 life happens. We'd love to get you rebooked whenever you're ready. Reply YES to schedule. Reply STOP to opt out.",
    },
    'consult-only': {
        label: "We'd Love to See You",
        template: "Hi {{firstName}}, thanks for coming in for your consultation at Chin Up! We'd love to help you take the next step. Reply YES if you'd like to schedule your treatment. Reply STOP to opt out.",
    },
    'lapsed-vip': {
        label: 'VIP Welcome Back',
        template: "Hi {{firstName}}, as one of our valued patients at Chin Up!, we wanted to personally invite you back. We've added exciting new treatments \u2014 reply YES to learn more. Reply STOP to opt out.",
    },
    'lapsed-long': {
        label: 'We Miss You',
        template: "Hi {{firstName}}, it's been a while! We'd love to welcome you back to Chin Up! with something special for returning patients. Reply YES for details. Reply STOP to opt out.",
    },
    'ghost': {
        label: 'Still Thinking?',
        template: "Hi {{firstName}}, still considering treatments at Chin Up!? We now offer Cherry financing \u2014 apply here: https://pay.withcherry.com/chinupaesthetics. Plus HydraFacials starting at $199. Reply YES for details. Reply STOP to opt out.",
    },
    'pipeline-followup': {
        label: 'Quick Follow-Up',
        template: "Hi {{firstName}}, following up on your inquiry with Chin Up! We offer Cherry financing for any treatment, plus HydraFacials starting at $199. Reply YES to learn more. Reply STOP to opt out.",
    },
    'vip-winback-offer': {
        label: 'VIP Win-Back Offer',
        template: "Hi {{firstName}}, it's Sam from Chin Up! Aesthetics - {{locationName}}.\nReal talk — we're reaching out to a small group of past clients we'd love to see again \u2764\uFE0F\nSpecial Offer: Complimentary add-on (dermaplaning, B12 shot, or light chemical peel) with any booking OR $75 OFF any service — offers can scale based on what you are interested in!\nReply BOOK to claim yours!\nReply STOP to opt out",
    },
};

/* ── Email Templates (6 campaigns) ───────────────────────── */

export const EMAIL_TEMPLATES: Record<string, { label: string; subject: string; template: string }> = {
    'cancelled': {
        label: "Let's Reschedule",
        subject: "We'd love to see you at Chin Up!",
        template: `Hi {{firstName}},

We noticed you had to reschedule your appointment at Chin Up! We totally understand — life happens.

We'd love to get you rebooked whenever you're ready. Just reply to this email or call us to schedule.

Looking forward to seeing you!
Chin Up! Aesthetics {{locationName}}`,
    },
    'consult-only': {
        label: "We'd Love to See You",
        subject: "Ready for your next step at Chin Up!?",
        template: `Hi {{firstName}},

Thanks for coming in for your consultation at Chin Up! We'd love to help you take the next step.

Reply to this email or call us if you'd like to schedule your treatment. We're happy to answer any questions you may have.

Best,
Chin Up! Aesthetics {{locationName}}`,
    },
    'lapsed-vip': {
        label: 'VIP Welcome Back',
        subject: "We miss you at Chin Up!, {{firstName}}!",
        template: `Hi {{firstName}},

As one of our valued patients at Chin Up!, we wanted to personally invite you back. We've added some exciting new treatments since your last visit.

We'd love to welcome you back — reply to this email or call us to schedule.

Warmly,
Chin Up! Aesthetics {{locationName}}`,
    },
    'lapsed-long': {
        label: 'We Miss You',
        subject: "It's been a while, {{firstName}}!",
        template: `Hi {{firstName}},

It's been a while since your last visit! We'd love to welcome you back to Chin Up! with something special for returning patients.

Reply to this email or call us for details.

Best,
Chin Up! Aesthetics {{locationName}}`,
    },
    'ghost': {
        label: 'Still Thinking?',
        subject: "Still considering treatments at Chin Up!?",
        template: `Hi {{firstName}},

Still considering treatments at Chin Up!? We wanted to let you know about a couple things:

🌟 Cherry Financing — Apply here: https://pay.withcherry.com/chinupaesthetics
   Break your treatment into easy monthly payments with no impact on your credit score.

💧 HydraFacials starting at $199
   Our most popular facial treatment — great for first-timers and regulars alike.

Reply to this email or call us to schedule. We'd love to help you get started!

Best,
Chin Up! Aesthetics {{locationName}}`,
    },
    'pipeline-followup': {
        label: 'Quick Follow-Up',
        subject: "Following up from Chin Up! Aesthetics",
        template: `Hi {{firstName}},

Just following up on your inquiry with Chin Up! We wanted to make sure you know about:

🌟 Cherry Financing — https://pay.withcherry.com/chinupaesthetics
   Apply in minutes, no impact on your credit score.

💧 HydraFacials starting at $199

We'd love to help you take the next step. Reply to this email or call us to learn more.

Best,
Chin Up! Aesthetics {{locationName}}`,
    },
    'vip-winback-offer': {
        label: 'VIP Win-Back Offer',
        subject: "We'd love to see you again, {{firstName}}!",
        template: `Hi {{firstName}},

It's Sam from Chin Up! Aesthetics — {{locationName}}.

Real talk — we're reaching out to a small group of past clients we'd love to see again ❤️

As a special offer for you:

✨ Complimentary add-on (dermaplaning, B12 shot, or light chemical peel) with any booking
— OR —
💰 $75 OFF any service

Offers can scale based on what you're interested in!

Reply to this email or call us to claim yours.

Warmly,
Sam
Chin Up! Aesthetics {{locationName}}`,
    },
};
