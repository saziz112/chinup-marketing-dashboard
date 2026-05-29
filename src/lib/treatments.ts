/**
 * Normalize a MindBody sale line-item description into a canonical CLINICAL
 * treatment name, or null if it isn't a targetable treatment.
 *
 * Treatment names live in mb_sales_history.items_json (the appointments table has
 * no session_type_name). Descriptions are messy: "Botox - Service", "Botox - Member
 * Discount", "Dysport_Inventory", "HR - Small Area", "SB - Chemical Peel", plus
 * non-treatment noise (fees, tips, gift cards, retail skincare, memberships).
 *
 * Policy (confirmed with Sam): all fillers grouped as "Filler"; clinical treatments
 * only — exclude retail skincare and MIC B12 membership.
 */
export function normalizeTreatment(descRaw: string | null | undefined): string | null {
    if (!descRaw) return null;
    const d = descRaw.trim();
    const s = d.toLowerCase();

    // --- Exclude retail skincare & non-treatment lines first ---
    // Retail skincare (products taken home, not in-clinic treatments)
    if (/^zo[\s-]|alpharet|hydrinity|\bpads?\b|spf|broad-?spectrum|cleanser|power defense|overnight cream|skin ?care kit|\bserum\b|moisturizer|daily sheer|sunscreen|\bkit\b/.test(s)) return null;
    // Membership / wellness add-on (excluded per clinical-only)
    if (/mic b12|\bb12\b/.test(s)) return null;
    // Admin / financial / consult lines
    if (/consult|\bfee\b|\btips?\b|gratuity|\bdeposit\b|gift ?card|class ?pass|prepay|no.?show|follow.?up|cancellation/.test(s)) return null;

    // --- Map to canonical clinical treatments (order matters) ---
    if (/lip ?flip/.test(s)) return 'Lip Flip';
    if (/botox/.test(s)) return 'Botox';
    if (/dysport/.test(s)) return 'Dysport';
    if (/sculptra|restylane|juvederm|versa|\brha\b|filler|kysse|defyne|refyne|contour|\blyft\b|voluma|vollure|radiesse/.test(s)) return 'Filler';
    if (/hydra ?facial|\bhf\b|hf -/.test(s)) return 'HydraFacial';
    if (/cool ?peel/.test(s)) return 'CoolPeel';
    if (/chemical peel|vi peel|\bpeel\b/.test(s)) return 'Chemical Peel';
    if (/microneedling|skin ?pen|skinpen|rf micro|venus rf|virtue/.test(s)) return 'Microneedling';
    if (/dermaplaning/.test(s)) return 'Dermaplaning';
    if (/emsculpt|emsella/.test(s)) return 'Emsculpt';
    if (/\bhr\b|laser hair|\blhr\b/.test(s)) return 'Laser Hair Removal';

    return null; // unrecognized → not a targetable clinical treatment
}

/** Canonical treatment names, useful for validation/ordering. */
export const CLINICAL_TREATMENTS = [
    'Botox', 'Dysport', 'Lip Flip', 'Filler', 'HydraFacial',
    'Chemical Peel', 'CoolPeel', 'Microneedling', 'Dermaplaning',
    'Emsculpt', 'Laser Hair Removal',
] as const;
