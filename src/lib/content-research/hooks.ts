/**
 * "Clear over clever" hook checks: every hook names the treatment and the
 * exact $ price, and reads at a 5th-grade level (Flesch-Kincaid grade < 6).
 */

export interface HookOffer {
    treatment: string;
    /** Other names that are accurate for this offer (e.g. "tox" for Dysport). */
    aliases?: string[];
    price: number;
}

export interface HookCheck {
    ok: boolean;
    namesTreatment: boolean;
    namesPrice: boolean;
    grade: number;
    problems: string[];
}

/** Flesch-Kincaid grade must be below this (i.e. 5th grade or easier). */
export const MAX_GRADE = 6;

export function parsePrice(input: string): number | null {
    const m = input.trim().match(/^\$?\s*(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?$/);
    if (!m) return null;
    const value = Number(m[1].replace(/,/g, '') + (m[2] ?? ''));
    return value > 0 ? value : null;
}

export function formatPrice(price: number): string {
    const hasCents = Math.round(price * 100) % 100 !== 0;
    return '$' + price.toLocaleString('en-US', { minimumFractionDigits: hasCents ? 2 : 0, maximumFractionDigits: 2 });
}

export function countSyllables(word: string): number {
    const w = word.toLowerCase().replace(/[^a-z]/g, '');
    if (!w) return 1; // numbers / prices read as one beat
    if (w.length <= 3) return 1;
    const trimmed = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
    const groups = trimmed.match(/[aeiouy]{1,2}/g);
    return Math.max(1, groups ? groups.length : 1);
}

function words(text: string): string[] {
    return text.split(/\s+/).map(w => w.replace(/^[^\w$]+|[^\w]+$/g, '')).filter(Boolean);
}

export function gradeLevel(text: string): number {
    const ws = words(text);
    if (ws.length === 0) return 0;
    const sentences = Math.max(1, (text.match(/[.!?]+(\s|$)/g) || []).length);
    const syllables = ws.reduce((s, w) => s + countSyllables(w), 0);
    return 0.39 * (ws.length / sentences) + 11.8 * (syllables / ws.length) - 15.59;
}

function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function namesTerm(text: string, term: string): boolean {
    return new RegExp(`(^|[^A-Za-z])${escapeRe(term)}(?![A-Za-z])`, 'i').test(text);
}

function pricesIn(text: string): number[] {
    return [...text.matchAll(/\$\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?/g)]
        .map(m => Number(m[1].replace(/,/g, '') + (m[2] ?? '')));
}

export function validateHook(hook: string, offer: HookOffer): HookCheck {
    const terms = [offer.treatment, ...(offer.aliases ?? [])].filter(t => t.trim());
    const namesTreatment = terms.some(t => namesTerm(hook, t));
    const namesPrice = pricesIn(hook).some(p => Math.abs(p - offer.price) < 0.005);

    // Score readability without the treatment name: it's required, and brand
    // names like "Microneedling" would otherwise fail every hook.
    let plain = hook;
    for (const t of terms) plain = plain.replace(new RegExp(escapeRe(t), 'gi'), 'it');
    const grade = Math.round(gradeLevel(plain) * 10) / 10;

    const problems: string[] = [];
    if (!namesTreatment) problems.push(`Doesn't name the treatment (${offer.treatment}).`);
    if (!namesPrice) problems.push(`Doesn't say the price (${formatPrice(offer.price)}).`);
    if (grade >= MAX_GRADE) problems.push(`Reads at grade ${grade}; aim for 5th grade or lower.`);

    return { ok: problems.length === 0, namesTreatment, namesPrice, grade, problems };
}
