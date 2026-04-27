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

/* ── SMS Templates ───────────────────────────────────────────── */
/*
 * Each segment has 3 variants representing distinct copy strategies.
 * Templates are research-informed (medspa-specific patterns):
 *   - Loss-aversion ~2x stronger than gain framing for lapsed patients
 *   - Provider-attributed messages convert ~48% better than clinic-attributed
 *   - First-name + location personalization = ~119% lift over no personalization
 *   - Cold/never-converted segments → keyword reply CTA (lower friction)
 *   - Warm/repeat patients → can use links
 *   - Healthcare/luxury verticals: emojis erode credibility (use sparingly)
 *   - Single-segment SMS (≤160 chars after rendering) for cost + deliverability
 *   - TCPA: STOP language required, brand name on first-touch SMS
 */

export interface SmsVariant {
    id: string;
    label: string;
    strategy: string;
    template: string;
}

export const SMS_TEMPLATES: Record<string, { label: string; defaultVariantId: string; variants: SmsVariant[] }> = {
    'cancelled': {
        label: "Let's Reschedule",
        defaultVariantId: 'warmth',
        variants: [
            {
                id: 'warmth',
                label: 'Personalized warmth',
                strategy: 'Held-slot framing, no pressure. Best when relationship was warm before cancellation.',
                template: "Hi {{firstName}}, Chin Up! {{locationName}} here — we held your slot when you rescheduled. Want a new time? Reply YES. Reply STOP to opt out.",
            },
            {
                id: 'curiosity',
                label: 'Curiosity hook',
                strategy: 'Open-ended check-in invites a reply. Use for ghosted reschedules where the cause is unclear.',
                template: "Hi {{firstName}}, Chin Up! {{locationName}} — anything come up after your booking? Reply YES to find a new time. Reply STOP to opt out.",
            },
            {
                id: 'direct',
                label: 'Direct CTA',
                strategy: 'Frictionless rebook with a clear keyword. Best for action-oriented patients.',
                template: "Hi {{firstName}}, ready to rebook at Chin Up! {{locationName}}? Reply BOOK and we'll get you on the calendar. Reply STOP to opt out.",
            },
        ],
    },
    'consult-only': {
        label: "We'd Love to See You",
        defaultVariantId: 'financing',
        variants: [
            {
                id: 'financing',
                label: 'Cost reframe',
                strategy: "Tackles the #1 reason consults don't convert: price. Leads with Cherry financing + $199 entry.",
                template: "Hi {{firstName}}, Chin Up! {{locationName}} here. Cherry financing or our $199 HydraFacial — interested? Reply YES. Reply STOP to opt out.",
            },
            {
                id: 'provider',
                label: 'Provider attribution',
                strategy: 'Provider-attributed messages convert ~48% better than clinic-attributed. Builds personal trust.',
                template: "Hi {{firstName}}, your provider at Chin Up! {{locationName}} thought you'd be a great fit. Want to chat? Reply YES. Reply STOP to opt out.",
            },
            {
                id: 'curiosity',
                label: 'Curiosity question',
                strategy: 'Asks what blocked the conversion. Surfaces real objections you can address 1:1.',
                template: "Hi {{firstName}}, Chin Up! {{locationName}} — quick question: what's been holding you back since your consult? Reply STOP to opt out.",
            },
        ],
    },
    'lapsed-vip': {
        label: 'VIP Welcome Back',
        defaultVariantId: 'exclusivity',
        variants: [
            {
                id: 'exclusivity',
                label: 'VIP recognition',
                strategy: 'Status framing protects margin (vs. discount). Works on $3K+ LTV patients.',
                template: "Hi {{firstName}}, you're one of our most valued at Chin Up! {{locationName}} — we'd love to see you again. Reply YES. Reply STOP to opt out.",
            },
            {
                id: 'loss',
                label: 'Loss aversion',
                strategy: 'Results-fading framing. Loss aversion is ~2x stronger than gain framing for lapsed patients.',
                template: "Hi {{firstName}}, Chin Up! {{locationName}} — results may be fading. A quick maintenance visit keeps you fresh. Reply YES. Reply STOP to opt out.",
            },
            {
                id: 'provider',
                label: 'Provider planning',
                strategy: 'Complimentary planning session with provider — zero pressure, zero discount erosion.',
                template: "Hi {{firstName}}, Chin Up! {{locationName}} — your provider would love to plan next steps. Complimentary session? Reply YES. Reply STOP to opt out.",
            },
        ],
    },
    'lapsed-long': {
        label: 'We Miss You',
        defaultVariantId: 'reintro',
        variants: [
            {
                id: 'reintro',
                label: 'Re-introduction',
                strategy: '"What\'s new since you left" framing. Resets the relationship without leading with discount.',
                template: "Hi {{firstName}}, it's been a minute! Chin Up! {{locationName}} has new treatments since your last visit. Curious? Reply YES. Reply STOP to opt out.",
            },
            {
                id: 'clinical',
                label: 'Soft clinical reminder',
                strategy: 'No-offer check-in. Uses maintenance framing instead of promo to protect brand.',
                template: "Hi {{firstName}}, Chin Up! {{locationName}} — it's been a while. A quick check-in might be perfect timing. Reply YES. Reply STOP to opt out.",
            },
            {
                id: 'offer',
                label: 'Low-risk re-entry',
                strategy: "$199 HydraFacial as a low-commitment way back in. Use when no-offer pings haven't worked.",
                template: "Hi {{firstName}}, Chin Up! {{locationName}} — welcome back with our $199 HydraFacial. Easy way to ease in. Reply YES. Reply STOP to opt out.",
            },
        ],
    },
    'ghost': {
        label: 'Still Thinking?',
        defaultVariantId: 'offer',
        variants: [
            {
                id: 'offer',
                label: 'Cost-objection killer',
                strategy: '$199 HydraFacial is a price-objection killer for cold leads. Removes the biggest blocker upfront.',
                template: "Hi {{firstName}}, Chin Up! {{locationName}} here — our $199 HydraFacial is a great way to start. Want details? Reply YES. Reply STOP to opt out.",
            },
            {
                id: 'social',
                label: 'Social proof',
                strategy: 'Authority framing for cautious leads. Quantifies trust without being pushy.',
                template: "Hi {{firstName}}, Chin Up! {{locationName}} — we've helped 2,000+ Atlanta clients feel their best. Ready to try? Reply YES. Reply STOP to opt out.",
            },
            {
                id: 'curiosity',
                label: 'Curiosity hook',
                strategy: 'Open question surfaces objections. Lower friction than a CTA — invites conversation.',
                template: "Hi {{firstName}}, Chin Up! {{locationName}} — we never got to meet. Quick question — what's been on your mind? Reply STOP to opt out.",
            },
        ],
    },
    'pipeline-followup': {
        label: 'Quick Follow-Up',
        defaultVariantId: 'direct',
        variants: [
            {
                id: 'direct',
                label: 'Direct availability',
                strategy: 'Concrete provider availability creates real urgency. Best for warm pipeline leads.',
                template: "Hi {{firstName}}, Chin Up! {{locationName}} — your provider has openings this week. Want to lock one in? Reply BOOK. Reply STOP to opt out.",
            },
            {
                id: 'financing',
                label: 'Financing angle',
                strategy: 'For pipeline leads where cost is the suspected blocker. Brand-domain Cherry link.',
                template: "Hi {{firstName}}, Chin Up! {{locationName}} — Cherry financing makes treatment easy: pay.withcherry.com/chinupaesthetics. Reply STOP to opt out.",
            },
            {
                id: 'scarcity',
                label: 'Real scarcity',
                strategy: "Authentic calendar pressure (not manufactured countdowns). Works because it's true.",
                template: "Hi {{firstName}}, Chin Up! {{locationName}} — calendar fills fast this week. Want us to hold a slot? Reply YES. Reply STOP to opt out.",
            },
        ],
    },
    'vip-winback-offer': {
        label: 'VIP Win-Back Offer',
        defaultVariantId: 'offer',
        variants: [
            {
                id: 'offer',
                label: 'Concrete reward',
                strategy: 'Strong, specific offer ($75 off + complimentary add-on). VIPs respond to dollar value, not %.',
                template: "Hi {{firstName}}, Sam from Chin Up! {{locationName}}. VIP offer: complimentary add-on or $75 OFF. Reply BOOK to claim. Reply STOP to opt out.",
            },
            {
                id: 'loss',
                label: 'Expiring offer',
                strategy: 'Loss aversion on the VIP-pricing tier. Authentic deadline drives action.',
                template: "Hi {{firstName}}, Chin Up! {{locationName}} — your VIP $75 off + free add-on offer expires soon. Reply BOOK to claim. Reply STOP to opt out.",
            },
            {
                id: 'personal',
                label: 'Personal note',
                strategy: 'Human-attributed (Sam) reach-out. High-touch — feels 1:1, not blast.',
                template: "Hi {{firstName}}, Sam from Chin Up! {{locationName}} — reaching out personally. Did you see your VIP offer? Reply YES. Reply STOP to opt out.",
            },
        ],
    },
    'lapsed-winback': {
        label: 'Win-Back VIP',
        defaultVariantId: 'combo',
        variants: [
            {
                id: 'combo',
                label: 'Re-intro + offer',
                strategy: "Combines what's-new with returning-VIP pricing. Hedges between two strong angles.",
                template: "Hi {{firstName}}, Chin Up! {{locationName}} — over a year since we've seen you. VIP pricing's waiting. Reply YES. Reply STOP to opt out.",
            },
            {
                id: 'loss',
                label: 'Loss aversion',
                strategy: 'Results degradation framing — strongest for 12+ month lapsed patients with prior treatments.',
                template: "Hi {{firstName}}, Chin Up! {{locationName}} — over a year and your results may have faded. Reply YES to refresh. Reply STOP to opt out.",
            },
            {
                id: 'soft',
                label: 'Soft check-in',
                strategy: 'No offer, no CTA pressure. Use after a previous offer-led message had no reply.',
                template: "Hi {{firstName}}, Chin Up! {{locationName}} — just thinking of you. It's been a while. Reply YES if you'd like to chat. Reply STOP to opt out.",
            },
            {
                id: 'seasonal',
                label: 'Seasonal warmth',
                strategy: 'Spring/seasonal hook + tease at VIP promos. Multi-line, emoji-friendly — feels personal, not corporate. Multi-segment SMS (~270 chars).',
                template: "Hi {{firstName}}! It’s Chin Up! {{locationName}} 🌸\n\nSpring is here… perfect time for a little refresh, right?\n\nIt’s been over a year since we’ve seen you, so we put together some VIP promos just for our returning patients 👀\n\nReply YES to see them or STOP to opt out.",
            },
        ],
    },
    'lapsed-treatment': {
        label: 'Treatment Reminder',
        defaultVariantId: 'maintenance',
        variants: [
            {
                id: 'maintenance',
                label: 'Maintenance window',
                strategy: 'Clinical 3-4 month framing. No discount — protects margin and reinforces medical credibility.',
                template: "Hi {{firstName}}, Chin Up! {{locationName}} — your last treatment typically lasts 3-4 months. Touch-up time? Reply YES. Reply STOP to opt out.",
            },
            {
                id: 'provider',
                label: 'Provider flagged',
                strategy: 'Provider authority + personalized "flagged for touch-up". Implies care, not bulk send.',
                template: "Hi {{firstName}}, Chin Up! {{locationName}} — your provider flagged you for a touch-up window. Want to schedule? Reply YES. Reply STOP to opt out.",
            },
            {
                id: 'direct',
                label: 'Direct CTA',
                strategy: 'Action keyword. Use when you know the patient is action-oriented (e.g., responded fast before).',
                template: "Hi {{firstName}}, Chin Up! {{locationName}} — ready for a touch-up? Reply BOOK and we'll get you on the calendar. Reply STOP to opt out.",
            },
        ],
    },
    'never-booked': {
        label: 'First Visit Invite',
        defaultVariantId: 'offer',
        variants: [
            {
                id: 'offer',
                label: 'Entry-point offer',
                strategy: '$199 HydraFacial as a low-commitment first visit. Removes price anxiety from cold leads.',
                template: "Hi {{firstName}}, thanks for reaching out to Chin Up! {{locationName}} — start with our $199 HydraFacial? Reply YES. Reply STOP to opt out.",
            },
            {
                id: 'social',
                label: 'Social proof',
                strategy: 'Quantified trust signal. Best for cautious first-timers nervous about going to "any" medspa.',
                template: "Hi {{firstName}}, Chin Up! {{locationName}} — 2,000+ Atlanta clients trust us. Ready to book your first visit? Reply YES. Reply STOP to opt out.",
            },
            {
                id: 'curiosity',
                label: "What's the blocker?",
                strategy: 'Surfaces objections via direct question. Sales-team friendly — invites a 1:1 reply.',
                template: "Hi {{firstName}}, Chin Up! {{locationName}} — quick question: what's been holding you back? Happy to help. Reply STOP to opt out.",
            },
        ],
    },
};

/**
 * Get a specific SMS variant template, falling back to the segment default.
 * Used when sending campaigns — the UI passes the chosen variantId.
 */
export function getSmsTemplate(segment: string, variantId?: string): string | null {
    const seg = SMS_TEMPLATES[segment];
    if (!seg) return null;
    const variant = (variantId && seg.variants.find(v => v.id === variantId))
        || seg.variants.find(v => v.id === seg.defaultVariantId)
        || seg.variants[0];
    return variant?.template || null;
}

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
    'lapsed-winback': {
        label: 'Win-Back VIP',
        subject: "We'd love to welcome you back, {{firstName}}!",
        template: `Hi {{firstName}},

It's been over a year since your last visit to Chin Up! Aesthetics and we truly miss seeing you.

We've added some exciting new treatments and would love to welcome you back with special VIP pricing.

Reply to this email or call us to schedule your return visit.

Warmly,
Chin Up! Aesthetics {{locationName}}`,
    },
    'lapsed-treatment': {
        label: 'Treatment Reminder',
        subject: "Time for a touch-up, {{firstName}}?",
        template: `Hi {{firstName}},

It's been a while since your last treatment at Chin Up! Aesthetics. Many of our patients find that regular maintenance keeps their results looking fresh.

We'd love to help you schedule your next session. Reply to this email or call us anytime.

Best,
Chin Up! Aesthetics {{locationName}}`,
    },
    'never-booked': {
        label: 'First Visit Invite',
        subject: "Ready to get started, {{firstName}}?",
        template: `Hi {{firstName}},

Thanks for your interest in Chin Up! Aesthetics! We'd love to help you take the next step and schedule your first visit.

A few things to know:

Cherry Financing — https://pay.withcherry.com/chinupaesthetics
Break your treatment into easy monthly payments.

HydraFacials starting at $199
Our most popular treatment for first-time visitors.

Reply to this email or call us to schedule. We look forward to meeting you!

Best,
Chin Up! Aesthetics {{locationName}}`,
    },
};
