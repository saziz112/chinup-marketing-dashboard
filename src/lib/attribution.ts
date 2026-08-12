/**
 * Lead-source channel normalization (PLAN item 22).
 *
 * Neither GHL's `source` string nor Meta's native `attributionSource` is
 * correct on its own. Measured against live data 2026-08-11 (n=60 per bucket):
 *
 *   source='Website'      -> 53/60 native attribution says "CRM Workflows /
 *                            Manual", which is not a channel. Native is WORSE
 *                            here; grouping by it dissolves the highest-value
 *                            channel in the report.
 *   source='chat widget'  -> native resolves 60 flat rows into Organic (28),
 *                            Direct (18), Social (10), Paid Search (3),
 *                            Referral (1). Native is far BETTER here.
 *   source='Facebook'     -> 58/60 native says Paid Social. They agree.
 *
 * Hence the precedence below. See
 * docs/superpowers/specs/2026-08-10-lead-source-tracking-design.md
 */

export type Channel =
  | 'Paid Social'
  | 'Paid Search'
  | 'Website'
  | 'Call-In'
  | 'Organic Search'
  | 'Social Media'
  | 'Direct'
  | 'Referral'
  | 'Internal'
  | 'Other'
  | 'Unattributed';

/** Shape GHL returns on a single-contact GET. The list endpoint omits it. */
export interface AttributionSource {
  sessionSource?: string | null;
  medium?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  formName?: string | null;
  adSource?: string | null;
  campaign?: string | null;
  referrer?: string | null;
}

/**
 * sessionSource values that describe how the record was CREATED rather than
 * where the person came from. These carry no channel information and must
 * never be reported as a source.
 */
const NON_CHANNEL_SESSION_SOURCES = new Set(['CRM Workflows', 'CRM UI']);

/** sessionSource values that ARE genuine acquisition channels. */
const SESSION_SOURCE_TO_CHANNEL: Record<string, Channel> = {
  'Paid Social': 'Paid Social',
  'Paid Search': 'Paid Search',
  'Organic Search': 'Organic Search',
  'Social media': 'Social Media',
  'Direct traffic': 'Direct',
  Referral: 'Referral',
};

/**
 * First-party `source` labels we trust over native attribution, because the
 * CRM knows something Meta does not (rule 2).
 *
 * `chat widget` is deliberately ABSENT: native attribution resolves it into a
 * real upstream channel and is strictly better.
 * `Facebook` is deliberately ABSENT: rule 1 handles paid social.
 */
function firstPartySourceChannel(source: string): Channel | null {
  const s = source.trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith('google ads')) return 'Paid Search';
  if (s === 'website') return 'Website';
  if (s === 'call-in' || s === 'call in') return 'Call-In';
  if (s === 'virtual consultation form') return 'Website';
  if (s.includes('landing page')) return 'Website';
  if (s === 'wellness waitlist') return 'Website';
  if (s === 'monthly-bonus-dashboard') return 'Internal';
  return null;
}

/** True when attribution shows this lead came from a paid ad unit. */
function isPaidAd(a: AttributionSource): boolean {
  const medium = (a.medium || '').toLowerCase();
  const utmSource = (a.utmSource || '').toLowerCase();
  // A lead form attached to a facebook/instagram medium is a paid ad unit.
  if (a.formName && (medium === 'facebook' || medium === 'instagram')) return true;
  // An explicit utm_source is only set by a campaign we tagged.
  if (utmSource === 'facebook' || utmSource === 'ig' || utmSource === 'instagram') return true;
  return false;
}

/**
 * Resolve one contact to a reporting channel.
 *
 * Precedence (validated 2026-08-11):
 *   1. paid ad signal in attribution        -> Paid Social / Paid Search
 *   2. meaningful first-party `source`      -> that label
 *   3. real web channel in attribution      -> that channel
 *   4. otherwise                            -> Other / Unattributed
 */
export function resolveChannel(
  source: string | null | undefined,
  attribution: AttributionSource | null | undefined,
): Channel {
  const a = attribution || {};
  const sessionSource = a.sessionSource || '';

  // 1. Paid ads win outright — this is the spend we are measuring against.
  if (isPaidAd(a)) {
    return sessionSource === 'Paid Search' ? 'Paid Search' : 'Paid Social';
  }

  // 2. Trust the CRM's own label where it means something.
  const firstParty = source ? firstPartySourceChannel(source) : null;
  if (firstParty) return firstParty;

  // 3. Fall back to native attribution when it names a real channel.
  const mapped = SESSION_SOURCE_TO_CHANNEL[sessionSource];
  if (mapped) return mapped;

  // 4. Nothing usable. Distinguish "attribution exists but is empty" (Other)
  //    from "no attribution at all" (Unattributed) so the gap stays visible.
  if (NON_CHANNEL_SESSION_SOURCES.has(sessionSource)) return 'Unattributed';
  if (sessionSource) return 'Other';
  return 'Unattributed';
}

/** Channels backed by ad spend, for CPL / cost-per-showed joins. */
export const PAID_CHANNELS: readonly Channel[] = ['Paid Social', 'Paid Search'];

/** Minimum row size before a rate may be rendered (spec: honesty requirements). */
export const MIN_REPORTABLE_N = 30;
