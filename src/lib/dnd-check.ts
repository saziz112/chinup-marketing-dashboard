/**
 * Unified DND (Do Not Disturb) checking + phone/email hashing
 * Replaces 3 inconsistent DND patterns across the codebase.
 * HIPAA-safe: hashPhone/hashEmail produce SHA-256 for campaign logs.
 */

import { createHash } from 'crypto';

const DND_TAG_PATTERN = /dnd|do.not.disturb|opted.out|unsubscribe|opt.out|stop|blocked/i;

export interface DndInput {
    /** GHL native dnd boolean */
    dnd?: boolean;
    /** GHL dndSettings object */
    dndSettings?: {
        SMS?: { status?: string };
        Email?: { status?: string };
        Call?: { status?: string };
    };
    /** GHL contact tags */
    tags?: string[];
}

/**
 * Check if a contact is on DND for a given channel.
 * Returns true if the contact should NOT be messaged.
 */
export function checkDND(
    input: DndInput,
    channel: 'sms' | 'email' = 'sms',
    contactField?: string, // phone or email — if empty, return true (can't send)
): boolean {
    // No phone/email = can't send
    if (!contactField) return true;

    // Native GHL DND flag
    if (input.dnd === true) return true;

    // Channel-specific DND
    if (channel === 'sms' && input.dndSettings?.SMS?.status === 'active') return true;
    if (channel === 'email' && input.dndSettings?.Email?.status === 'active') return true;

    // Tag-based DND
    if (input.tags?.some(t => DND_TAG_PATTERN.test(t))) return true;

    return false;
}

/**
 * Check DND from simple tag array + contactDND boolean (backward compat).
 * Used where we only have parsed opportunity data (contactDND + contactTags).
 */
export function checkDNDSimple(
    contactDND: boolean,
    tags: string[],
    channel: 'sms' | 'email' = 'sms',
    contactField?: string,
): boolean {
    return checkDND({ dnd: contactDND, tags }, channel, contactField);
}

/**
 * Normalize phone to 10-digit US number.
 * Strips +1, spaces, dashes, parens.
 */
export function normalizePhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
    if (digits.length === 10) return digits;
    return digits; // return as-is for non-US
}

/**
 * SHA-256 hash of normalized phone. HIPAA-safe for campaign logs.
 */
export function hashPhone(phone: string): string {
    const normalized = normalizePhone(phone);
    return createHash('sha256').update(normalized).digest('hex');
}

/**
 * SHA-256 hash of lowercase email. HIPAA-safe for campaign logs.
 */
export function hashEmail(email: string): string {
    return createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
}
