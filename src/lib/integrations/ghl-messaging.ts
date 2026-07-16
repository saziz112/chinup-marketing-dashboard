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
    vars: { firstName?: string; locationName?: string; lastService?: string; serviceName?: string; phone?: string },
): string {
    let rendered = template;
    rendered = rendered.replace(/\{\{firstName\}\}/g, vars.firstName || 'there');
    rendered = rendered.replace(/\{\{locationName\}\}/g, vars.locationName || 'Chin Up!');
    rendered = rendered.replace(/\{\{lastService\}\}/g, vars.lastService || 'your treatment');
    rendered = rendered.replace(/\{\{serviceName\}\}/g, vars.serviceName || 'your appointment');
    rendered = rendered.replace(/\{\{phone\}\}/g, vars.phone || '');
    return rendered;
}

/** Per-location call/text number (patient-facing). */
export const LOCATION_PHONES: Record<LocationKey, string> = {
    decatur: '770-766-5310',
    smyrna: '770-274-4220',
    kennesaw: '678-369-4268',
};

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
        lastService?: string;
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
            lastService: contact.lastService,
            phone: LOCATION_PHONES[locationKey],
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
        lastService?: string;
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

        const phone = LOCATION_PHONES[locationKey];
        const message = renderTemplate(messageTemplate, {
            firstName: contact.firstName,
            locationName,
            lastService: contact.lastService,
            phone,
        });
        const renderedSubject = renderTemplate(subject, {
            firstName: contact.firstName,
            locationName,
            lastService: contact.lastService,
            phone,
        });

        const result = await sendEmail(config.locationId, config.pit, contact.contactId, message, renderedSubject);
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
    'maintenance': {
        label: 'Maintenance Due',
        // Copy in Chin Up's brand voice — warm, low-pressure SUGGESTION (the patient
        // decides; avoids presumptuous "you're due" framing). Emoji (☺️) intentionally
        // kept per Sam's 2026-06 direction; note it pushes SMS to UCS-2 encoding
        // (~70 chars/segment) so these run ~4 segments each.
        defaultVariantId: 'thinking-of-you',
        variants: [
            {
                id: 'maintain',
                label: 'Maintain results',
                strategy: 'Results-confidence, low-pressure: frames a refresh as keeping their look effortless/natural, and leaves the decision to them.',
                template: "Hi {{firstName}}! Your {{lastService}} is right at the point where you may want a little refresher — it keeps everything looking effortless and natural ☺️ If that feels right for you, we'd love to see you back at Chin Up! {{locationName}}. Book anytime: https://chinupaesthetics.com/booking-calendar/ or call/text {{phone}}.\n\nReply DELETE to opt out.",
            },
            {
                id: 'thinking-of-you',
                label: 'Thinking of you',
                strategy: 'Warm/personal, no-pressure — leads with care and explicitly leaves timing up to them ("whenever you are").',
                template: "Hi {{firstName}}, thinking of you ☺️ Your {{lastService}} may be ready for a little refresh whenever you are — no rush at all. If you'd like to keep things looking refreshed and natural, we'd love to see you back at Chin Up! {{locationName}}. Book: https://chinupaesthetics.com/booking-calendar/ or call/text {{phone}}.\n\nReply DELETE to opt out.",
            },
            {
                id: 'glow',
                label: 'Treat-yourself glow',
                strategy: 'Aspirational self-care/glow-up framing as a gentle invitation — "totally your call".',
                template: "Hi {{firstName}}! If you're feeling ready for a little glow-up, it could be a lovely time to refresh your {{lastService}} ☺️ Totally your call — but if you'd like to, we'd love to see you at Chin Up! {{locationName}}. Treat yourself: https://chinupaesthetics.com/booking-calendar/ or call/text {{phone}}.\n\nReply DELETE to opt out.",
            },
        ],
    },
    'no-show-recovery': {
        label: 'No-Show / Cancellation Recovery',
        // Gentle same-week rebook nudge for patients who missed OR cancelled a recent
        // appointment and haven't rebooked. Tone stays warm and judgment-free (a cancel
        // is often intentional — sick, rescheduling), leaving the decision to them.
        // ☺️ kept per Sam's brand voice (forces UCS-2 → ~4 SMS segments each).
        defaultVariantId: 'find-a-time',
        variants: [
            {
                id: 'find-a-time',
                label: 'Find a new time',
                strategy: 'Warm, no-judgment: acknowledges the visit did not happen and offers to find a new time on their terms.',
                template: "Hi {{firstName}}! We noticed your recent visit to Chin Up! {{locationName}} didn't happen — no worries at all ☺️ Whenever you're ready, we'd love to help you find a new time. Book anytime: https://chinupaesthetics.com/booking-calendar/ or just call/text {{phone}}.\n\nReply DELETE to opt out.",
            },
            {
                id: 'easy-rebook',
                label: 'Easy rebook',
                strategy: 'Low-friction: emphasizes how quick it is to grab a new slot, reduces the effort barrier to rebooking.',
                template: "Hi {{firstName}}, it's Chin Up! {{locationName}} ☺️ Life happens — if your recent appointment slipped by, grabbing a new time is easy whenever it works for you: https://chinupaesthetics.com/booking-calendar/ or call/text {{phone}}. We'd love to see you!\n\nReply DELETE to opt out.",
            },
            {
                id: 'care-first',
                label: 'Care-first',
                strategy: 'Leads with genuine care ("hope all is well"), zero pressure — best for cancellations that may have been health-related.',
                template: "Hi {{firstName}}, we hope everything's okay! We saw your recent visit to Chin Up! {{locationName}} didn't work out — whenever you're ready, we're here ☺️ Rebook anytime: https://chinupaesthetics.com/booking-calendar/ or call/text {{phone}}.\n\nReply DELETE to opt out.",
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
    'maintenance': {
        label: 'Maintenance Due',
        subject: 'Consider this your sign to refresh your {{lastService}} ✨',
        // Branded HTML — cream #FBF8EF card, gold #C2A24E hairlines, charcoal #2C2A24
        // serif body (matches the Peptide & Medical Wellness menu look).
        template: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1EBDC;padding:32px 12px;font-family:Georgia,'Times New Roman',serif;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FBF8EF;border:1px solid #DCCBA0;border-radius:4px;">
<tr><td align="center" style="padding:36px 32px 8px;">
<img src="https://chinup-marketing-dashboard.vercel.app/logo.png" alt="Chin Up! Aesthetics" width="168" style="display:block;max-width:168px;height:auto;">
</td></tr>
<tr><td align="center" style="padding:14px 32px 0;">
<div style="font-family:Georgia,'Times New Roman',serif;color:#2C2A24;font-size:16px;letter-spacing:4px;text-transform:uppercase;font-weight:400;">Consider This Your Sign</div>
<div style="height:1px;width:56px;background:#C2A24E;margin:18px auto 0;"></div>
</td></tr>
<tr><td style="padding:24px 44px 0;color:#2C2A24;font-size:16px;line-height:1.75;">
<p style="margin:0 0 18px;">Hi {{firstName}},</p>
<p style="margin:0 0 18px;">Your {{lastService}} may be right at the point where a little refresher keeps everything looking natural, refreshed, and defined &mdash; if that feels right for you. &#9786;&#65039;</p>
<p style="margin:0 0 26px;">The secret to results that always look effortless? Staying on a gentle rhythm. Consistent treatments keep you looking like <em>you</em>, just your most polished self &mdash; no guesswork, our team handles the details. Whenever you&rsquo;re ready, we&rsquo;d love to see you back.</p>
</td></tr>
<tr><td align="center" style="padding:0 44px 6px;">
<a href="https://chinupaesthetics.com/booking-calendar/" style="display:inline-block;background:#D3A82C;color:#2C2A24;font-family:Georgia,'Times New Roman',serif;font-size:14px;letter-spacing:2px;text-transform:uppercase;text-decoration:none;padding:15px 40px;border-radius:3px;">Book My {{lastService}}</a>
</td></tr>
<tr><td align="center" style="padding:18px 44px 4px;color:#6E6656;font-size:14px;line-height:1.5;">
Prefer a real person? Call or text us at <a href="tel:{{phone}}" style="color:#2C2A24;text-decoration:none;border-bottom:1px solid #C2A24E;">{{phone}}</a>.
</td></tr>
<tr><td style="padding:24px 44px 0;"><div style="height:1px;background:#E4DAC2;width:100%;"></div></td></tr>
<tr><td align="center" style="padding:22px 44px 6px;">
<div style="font-family:Georgia,'Times New Roman',serif;font-style:italic;color:#2C2A24;font-size:19px;line-height:1.5;">Refreshed, defined, and effortlessly <span style="color:#B8912F;">you</span>.</div>
</td></tr>
<tr><td align="center" style="padding:26px 44px 34px;">
<div style="font-family:Georgia,'Times New Roman',serif;color:#6E6656;font-size:11px;letter-spacing:3px;text-transform:uppercase;">Decatur &nbsp;&middot;&nbsp; Kennesaw &nbsp;&middot;&nbsp; Vinings</div>
<div style="margin-top:12px;color:#9A927E;font-size:11px;line-height:1.6;">You&rsquo;re receiving this as a patient of Chin&nbsp;Up! Aesthetics &mdash; {{locationName}}.<br>To unsubscribe, reply DELETE.</div>
</td></tr>
</table>
</td></tr>
</table>`,
    },
    'no-show-recovery': {
        label: 'No-Show / Cancellation Recovery',
        subject: "Let's find a new time, {{firstName}} ☺️",
        // Branded HTML — cream #FBF8EF card, gold #C2A24E hairlines, charcoal #2C2A24
        // serif body (matches the Peptide & Medical Wellness menu look). Gentle,
        // no-pressure copy; {{firstName}}/{{locationName}}/{{phone}} render per-patient.
        template: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1EBDC;padding:32px 12px;font-family:Georgia,'Times New Roman',serif;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FBF8EF;border:1px solid #DCCBA0;border-radius:4px;">
<tr><td align="center" style="padding:36px 32px 8px;">
<img src="https://chinup-marketing-dashboard.vercel.app/logo.png" alt="Chin Up! Aesthetics" width="168" style="display:block;max-width:168px;height:auto;">
</td></tr>
<tr><td align="center" style="padding:14px 32px 0;">
<div style="font-family:Georgia,'Times New Roman',serif;color:#2C2A24;font-size:16px;letter-spacing:4px;text-transform:uppercase;font-weight:400;">Let&rsquo;s Find a New Time</div>
<div style="height:1px;width:56px;background:#C2A24E;margin:18px auto 0;"></div>
</td></tr>
<tr><td style="padding:24px 44px 0;color:#2C2A24;font-size:16px;line-height:1.75;">
<p style="margin:0 0 18px;">Hi {{firstName}},</p>
<p style="margin:0 0 18px;">We noticed your recent appointment at Chin&nbsp;Up! {{locationName}} didn&rsquo;t happen &mdash; and that&rsquo;s completely okay. Life gets full, and no explanation is needed. &#9786;&#65039;</p>
<p style="margin:0 0 26px;">Whenever the timing feels right for you, we&rsquo;d love to help you find a new one. It takes just a moment, and our team will handle the rest.</p>
</td></tr>
<tr><td align="center" style="padding:0 44px 6px;">
<a href="https://chinupaesthetics.com/booking-calendar/" style="display:inline-block;background:#D3A82C;color:#2C2A24;font-family:Georgia,'Times New Roman',serif;font-size:14px;letter-spacing:2px;text-transform:uppercase;text-decoration:none;padding:15px 40px;border-radius:3px;">Find a New Time</a>
</td></tr>
<tr><td align="center" style="padding:18px 44px 4px;color:#6E6656;font-size:14px;line-height:1.5;">
Prefer a real person? Call or text us at <a href="tel:{{phone}}" style="color:#2C2A24;text-decoration:none;border-bottom:1px solid #C2A24E;">{{phone}}</a>.
</td></tr>
<tr><td style="padding:24px 44px 0;"><div style="height:1px;background:#E4DAC2;width:100%;"></div></td></tr>
<tr><td align="center" style="padding:22px 44px 6px;">
<div style="font-family:Georgia,'Times New Roman',serif;font-style:italic;color:#2C2A24;font-size:19px;line-height:1.5;">Your glow will keep.<br>We&rsquo;ll be here whenever you&rsquo;re <span style="color:#B8912F;">ready</span>.</div>
</td></tr>
<tr><td align="center" style="padding:26px 44px 34px;">
<div style="font-family:Georgia,'Times New Roman',serif;color:#6E6656;font-size:11px;letter-spacing:3px;text-transform:uppercase;">Decatur &nbsp;&middot;&nbsp; Kennesaw &nbsp;&middot;&nbsp; Vinings</div>
<div style="margin-top:12px;color:#9A927E;font-size:11px;line-height:1.6;">You&rsquo;re receiving this as a patient of Chin&nbsp;Up! Aesthetics &mdash; {{locationName}}.<br>To unsubscribe, reply DELETE.</div>
</td></tr>
</table>
</td></tr>
</table>`,
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
    'lapsed-treatment': {
        label: 'Treatment Reminder',
        subject: "Time for a touch-up, {{firstName}}?",
        template: `Hi {{firstName}},

It's been a while since your last treatment at Chin Up! Aesthetics. Many of our patients find that regular maintenance keeps their results looking fresh.

We'd love to help you schedule your next session. Reply to this email or call us anytime.

Best,
Chin Up! Aesthetics {{locationName}}`,
    },
};
