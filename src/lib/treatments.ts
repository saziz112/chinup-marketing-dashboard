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
    if (/sculptra/.test(s)) return 'Sculptra'; // biostimulator — distinct from dermal filler
    if (/restylane|juvederm|versa|\brha\b|filler|kysse|defyne|refyne|contour|\blyft\b|voluma|vollure|radiesse|profile balancing/.test(s)) return 'Dermal Filler';
    if (/hydra ?facial|\bhf\b|hf -/.test(s)) return 'HydraFacial';
    if (/cool ?peel/.test(s)) return 'CoolPeel';
    if (/chemical peel|vi peel|\bpeel\b/.test(s)) return 'Chemical Peel';
    if (/microneedling|skin ?pen|skinpen|rf micro|venus rf|virtue/.test(s)) return 'Microneedling';
    if (/dermaplaning/.test(s)) return 'Dermaplaning';
    if (/emsculpt|emsella/.test(s)) return 'Emsculpt';
    if (/laser hair|\bhr\b|lhr/.test(s)) return 'Laser Hair Removal'; // 'lhr' substring also catches LHR_Inventory_Only
    if (/\bprp\b/.test(s)) return 'PRP'; // after microneedling: a combined "Microneedling + PRP" line stays Microneedling

    return null; // unrecognized → not a targetable clinical treatment
}

/** Canonical treatment names, useful for validation/ordering. */
export const CLINICAL_TREATMENTS = [
    'Botox', 'Dysport', 'Lip Flip', 'Dermal Filler', 'Sculptra', 'HydraFacial',
    'Chemical Peel', 'CoolPeel', 'Microneedling', 'Dermaplaning',
    'Emsculpt', 'Laser Hair Removal', 'PRP',
] as const;

/**
 * Maintenance-reminder cadence per treatment: a patient is "due" when
 * daysSinceLastTreatment ∈ [startDays, endDays]. Tuned from Chin Up's REAL
 * inter-visit data (median/p75 gaps) where the signal is clean, and from clinical
 * maintenance intervals for series-dominated treatments whose raw gaps reflect
 * in-series spacing (Emsculpt 7d median, Microneedling, Laser Hair Removal, Filler
 * build-up). Series/low-confidence windows are flagged — validate at the dry-run.
 * Empirical medians (days): Botox 102, Dysport 113, Filler 89, HydraFacial 83,
 * Chemical Peel 83, Microneedling 58, Dermaplaning 109, Laser 112, Emsculpt 7.
 */
export const TREATMENT_CADENCE: Record<string, { startDays: number; endDays: number }> = {
    'Botox': { startDays: 80, endDays: 175 },              // data-clean (median 102)
    'Dysport': { startDays: 85, endDays: 185 },            // data-clean (median 113)
    'Lip Flip': { startDays: 60, endDays: 150 },           // small sample
    'Dermal Filler': { startDays: 180, endDays: 365 },     // clinical maintenance (data skewed by build-up) — review
    'Sculptra': { startDays: 60, endDays: 180 },           // biostimulator: series + early maintenance — review
    'HydraFacial': { startDays: 35, endDays: 120 },
    'Chemical Peel': { startDays: 35, endDays: 120 },
    'CoolPeel': { startDays: 150, endDays: 300 },          // low confidence (only ~9 repeat patients)
    'Microneedling': { startDays: 40, endDays: 120 },      // series-influenced — review
    'Dermaplaning': { startDays: 45, endDays: 150 },
    'Emsculpt': { startDays: 90, endDays: 180 },           // clinical maintenance (data = in-series 7d) — review
    'Laser Hair Removal': { startDays: 42, endDays: 130 }, // series-influenced — review
    'PRP': { startDays: 90, endDays: 240 },                // Zenoti-only add-on; low confidence, clinical series+maintenance — review
};

/** Natural mid-sentence phrasing for {{lastService}} in messages. */
export const TREATMENT_DISPLAY: Record<string, string> = {
    'Botox': 'Botox',
    'Dysport': 'Dysport',
    'Lip Flip': 'lip flip',
    'Dermal Filler': 'dermal filler',
    'Sculptra': 'Sculptra',
    'HydraFacial': 'HydraFacial',
    'Chemical Peel': 'chemical peel',
    'CoolPeel': 'CoolPeel',
    'Microneedling': 'microneedling',
    'Dermaplaning': 'dermaplaning',
    'Emsculpt': 'Emsculpt',
    'Laser Hair Removal': 'laser hair removal',
};

/** Sales lookback for maintenance detection — max cadence end + buffer. */
export const MAINTENANCE_LOOKBACK_DAYS = 425;
