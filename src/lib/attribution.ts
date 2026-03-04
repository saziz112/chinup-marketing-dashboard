/**
 * Lead Attribution Logic
 * Maps MindBody ReferredBy field to attributed platforms.
 *
 * Real MindBody data shows these ReferredBy values:
 *   "Google" (most common), "Facebook", "Instagram", "Website",
 *   "Another Client", "Another client", "Botox Ad", "Filler Ad",
 *   "Affiliate Program", "Groupon", "Tier3 Media", person names, etc.
 */

export type AttributedPlatform =
    | 'google_organic'
    | 'meta_ads'
    | 'ig_organic'
    | 'referral'
    | 'unknown';

interface MappingRule {
    patterns: string[];
    platform: AttributedPlatform;
}

// Order matters: more specific patterns first
const MAPPING_RULES: MappingRule[] = [
    { patterns: ['botox ad', 'filler ad', 'lip ad', 'laser ad', 'tier3 media', 'tier3', 'facebook', 'fb', 'meta', 'instagram ad', 'ig ad'], platform: 'meta_ads' },
    { patterns: ['instagram', 'ig', 'insta'], platform: 'ig_organic' },
    { patterns: ['google ad', 'google ads', 'adwords', 'ppc'], platform: 'meta_ads' }, // Fallback to unknown/meta since we don't have a google_paid category anymore
    { patterns: ['google', 'google search', 'website', 'web', 'online', 'chinupaesthetics.com', 'client'], platform: 'google_organic' },
    { patterns: ['realself', 'yelp', 'referral', 'friend', 'word of mouth', 'family', 'coworker', 'roomie', 'sister'], platform: 'referral' },
];

/**
 * Map a MindBody ReferredBy string to an attributed platform.
 */
export function attributeSource(referredBy: string | null | undefined): AttributedPlatform {
    if (!referredBy) return 'unknown';

    const normalized = referredBy.toLowerCase().trim();
    if (!normalized) return 'unknown';

    // Skip date strings that accidentally end up in the field (e.g. "2001-01-01T00:00:00.000Z")
    if (/^\d{4}-\d{2}-\d{2}/.test(normalized)) return 'unknown';

    for (const rule of MAPPING_RULES) {
        for (const pattern of rule.patterns) {
            if (normalized.includes(pattern)) {
                return rule.platform;
            }
        }
    }

    // If it looks like a person's name (contains a space and no known keywords), it's likely a referral
    if (normalized.includes(' ') && /^[a-z]/.test(normalized)) {
        return 'referral';
    }

    return 'unknown';
}

/**
 * Get a human-readable label for an attributed platform.
 */
export function getPlatformLabel(platform: AttributedPlatform): string {
    const labels: Record<AttributedPlatform, string> = {
        google_organic: 'Google Organic',
        meta_ads: 'Meta Ads',
        ig_organic: 'IG Organic',
        referral: 'Referrals / Word of Mouth',
        unknown: 'Unknown',
    };
    return labels[platform];
}
