/**
 * POST /api/research/trends
 * Generate AI-powered trending topic ideas for content planning.
 * Uses Claude Haiku + 10 real data sources from Postgres + competitor IG data.
 *
 * Data Sources ($0 API cost, all cached/Postgres):
 *   1. Top 10 posts by engagement (social_posts)
 *   2. Top 15 Search Console queries (search_console_daily)
 *   3. Treatment booking trends — this month vs last month (mb_appointments_history)
 *   4. Patient review themes — recent reviews (reviews)
 *   5. Conversion-qualified lead sources — GHL→MindBody match (3-table join)
 *   6. Content gap analysis — 40 service keywords (social_posts)
 *   7. Format performance breakdown — avg engagement by post_type (social_posts)
 *   8. Top ad campaign themes (ad_campaigns + ad_metrics_daily)
 *   9. Competitor content intelligence — 7 Atlanta-area med spas (IG Business Discovery, 4h cache)
 *  10. Treatment revenue flags — top earners from MindBody sales (mb_sales_history)
 *  11. Performance feedback — how past suggested topics performed (content_posts + social_posts)
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sql } from '@vercel/postgres';
import { getIGCompetitorMetrics, type IGCompetitorMetrics } from '@/lib/integrations/meta-organic';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

export const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

// Seasonal context per month
export const SEASONAL_CONTEXT: Record<number, string> = {
    1: 'New Year resolutions, fresh start, "New Year New You" promotions, dry winter skin',
    2: 'Valentine\'s Day (Feb 14), self-love, couples treatments, winter skincare',
    3: 'Spring renewal, Women\'s History Month, spring break prep, daylight savings',
    4: 'Spring refresh, prom season, wedding prep begins, Skin Cancer Awareness Month, Easter, Earth Day',
    5: 'Mother\'s Day, pre-summer body prep, melanoma awareness, graduation season',
    6: 'Summer glow, wedding season peak, sun protection, Father\'s Day',
    7: 'Summer maintenance, mid-year skin check, back-to-school prep starting, Independence Day',
    8: 'Back-to-school, late summer skin repair, fall treatment planning begins',
    9: 'Fall skincare transition, laser season begins, pumpkin facials, Self-Care Awareness Month',
    10: 'Halloween, fall treatment peak, Breast Cancer Awareness Month, dry skin prep',
    11: 'Holiday prep, gift cards, Friendsgiving treatments, Black Friday deals, Movember',
    12: 'Holiday parties, year-end gift cards, New Year prep, winter hydration, holiday specials',
};

// Full service keyword map from MindBody product catalog
export const SERVICE_KEYWORDS = [
    // Neurotoxins
    { keyword: 'botox', label: 'Botox' },
    { keyword: 'dysport', label: 'Dysport' },
    { keyword: 'hyperhidrosis', label: 'Hyperhidrosis' },
    // Dermal Fillers — Restylane
    { keyword: 'restylane', label: 'Restylane' },
    { keyword: 'lip filler', label: 'Lip Filler' },
    { keyword: 'midface', label: 'Midface' },
    { keyword: 'chin filler', label: 'Chin Filler' },
    { keyword: 'cheek filler', label: 'Cheek Filler' },
    { keyword: 'under eye filler', label: 'Under-Eye Filler' },
    { keyword: 'profile balancing', label: 'Profile Balancing' },
    { keyword: 'sculptra', label: 'Sculptra' },
    { keyword: 'juvederm', label: 'Juvederm' },
    // Dissolving / Contouring
    { keyword: 'kybella', label: 'Kybella' },
    { keyword: 'hylenex', label: 'Filler Dissolving' },
    { keyword: 'double chin', label: 'Double Chin' },
    { keyword: 'platysmal', label: 'Platysmal Bands' },
    // PRP & Growth Factors
    { keyword: 'prp', label: 'PRP' },
    { keyword: 'pdgf', label: 'PDGF' },
    { keyword: 'exosome', label: 'Exosomes' },
    { keyword: 'hair rejuvenation', label: 'Hair Rejuvenation' },
    // Skin Treatments
    { keyword: 'hydrafacial', label: 'HydraFacial' },
    { keyword: 'keravive', label: 'Keravive (Scalp)' },
    { keyword: 'microneedling', label: 'Microneedling' },
    { keyword: 'rf microneedling', label: 'RF Microneedling' },
    { keyword: 'vi peel', label: 'VI Peel' },
    { keyword: 'cool peel', label: 'Cool Peel' },
    { keyword: 'chemical peel', label: 'Chemical Peel' },
    { keyword: 'dermaplaning', label: 'Dermaplaning' },
    // Body
    { keyword: 'emsculpt', label: 'Emsculpt Neo' },
    { keyword: 'emsella', label: 'Emsella' },
    { keyword: 'body sculpt', label: 'Body Sculpting' },
    { keyword: 'hair removal', label: 'Laser Hair Removal' },
    // Weight Loss / Wellness
    { keyword: 'semaglutide', label: 'Semaglutide' },
    { keyword: 'tirzepatide', label: 'Tirzepatide' },
    { keyword: 'weight loss', label: 'Weight Loss' },
    { keyword: 'b12', label: 'MIC B12' },
    { keyword: 'iv therapy', label: 'IV Therapy' },
    // Retail / Skincare
    { keyword: 'skinbetter', label: 'SkinBetter' },
    { keyword: 'hydrinity', label: 'Hydrinity' },
    { keyword: 'plated', label: 'Plated Skin Science' },
    { keyword: 'zo skin', label: 'ZO Skin Health' },
];

// MindBody booking links per treatment category
// TODO: Sam to provide actual MindBody direct booking URLs
const BOOKING_LINKS: Record<string, string> = {
    '_default': 'https://www.chinupaesthetics.com/book',
};

// ── Opportunity Score computation ──

interface OpportunityInputs {
    searchDemandMap: Map<string, { clicks: number; impressions: number }>;
    contentGapMap: Map<string, number>; // keyword → days since last post
    neverPostedSet: Set<string>;
    formatPerfMap: Map<string, number>; // format → avg engagement rate
    competitorTopicSet: Set<string>; // keywords competitors are posting about
    revenueMap: Map<string, number>; // keyword → annual revenue
    topRevenueKeywords: Set<string>; // top 10 revenue keywords
}

function computeOpportunityScore(
    topic: { title: string; format: string },
    inputs: OpportunityInputs,
): number {
    const titleLower = topic.title.toLowerCase();
    const matchedKeyword = SERVICE_KEYWORDS.find(sk => titleLower.includes(sk.keyword));
    const kw = matchedKeyword?.keyword || '';
    let score = 0;

    // 1. Search demand (0-30 pts)
    const search = inputs.searchDemandMap.get(kw);
    if (search) {
        // More clicks = higher demand. 50+ clicks = max points
        score += Math.min(30, Math.round((search.clicks / 50) * 20 + (search.impressions / 500) * 10));
    }

    // 2. Engagement potential based on format (0-25 pts)
    const formatKey = topic.format.toLowerCase();
    const formatEng = inputs.formatPerfMap.get(formatKey) || inputs.formatPerfMap.get('reel') || 0;
    score += Math.min(25, Math.round(formatEng * 100 * 6));

    // 3. Content freshness gap (0-25 pts)
    if (kw && inputs.neverPostedSet.has(kw)) {
        score += 25;
    } else if (kw) {
        const gapDays = inputs.contentGapMap.get(kw) || 0;
        if (gapDays >= 90) score += 25;
        else if (gapDays >= 60) score += 20;
        else if (gapDays >= 30) score += 15;
        else if (gapDays >= 14) score += 8;
    }

    // 4. Competitor activity (0-20 pts)
    if (kw && inputs.competitorTopicSet.has(kw)) {
        score += 20; // Competitors are posting about this = proven demand we're missing
    }

    return Math.min(100, Math.max(0, score));
}

function computeMoneyMakerAlert(
    topic: { title: string },
    inputs: OpportunityInputs,
): { active: boolean; message: string } | null {
    const titleLower = topic.title.toLowerCase();
    const matchedKeyword = SERVICE_KEYWORDS.find(sk => titleLower.includes(sk.keyword));
    if (!matchedKeyword) return null;

    const kw = matchedKeyword.keyword;
    if (!inputs.topRevenueKeywords.has(kw)) return null;

    const gapDays = inputs.contentGapMap.get(kw);
    const neverPosted = inputs.neverPostedSet.has(kw);

    if (neverPosted) {
        return { active: true, message: `Top revenue service — never posted about` };
    }
    if (gapDays && gapDays >= 30) {
        return { active: true, message: `Top revenue service — no post in ${gapDays} days` };
    }
    return null;
}

function findBookingUrl(topic: { title: string }): string {
    const titleLower = topic.title.toLowerCase();
    for (const sk of SERVICE_KEYWORDS) {
        if (titleLower.includes(sk.keyword) && BOOKING_LINKS[sk.keyword]) {
            return BOOKING_LINKS[sk.keyword];
        }
    }
    return BOOKING_LINKS['_default'];
}

// ── Build competitor context from IG data ──

function buildCompetitorContext(
    competitors: IGCompetitorMetrics[],
    contentGapMap: Map<string, number>,
    neverPostedSet: Set<string>,
): { context: string; competitorTopicSet: Set<string> } {
    const competitorTopicSet = new Set<string>();

    if (competitors.length === 0) {
        return { context: '', competitorTopicSet };
    }

    const lines: string[] = ['COMPETITOR CONTENT INTELLIGENCE (Atlanta-area med spas):'];

    for (const c of competitors.slice(0, 5)) {
        const engStr = c.avgEngagementRate ? `${(c.avgEngagementRate * 100).toFixed(1)}% avg engagement` : '';
        const freqStr = c.postingFrequency ? `${c.postingFrequency.toFixed(1)} posts/week` : '';
        const trendStr = c.engagementTrend ? `trend: ${c.engagementTrend}` : '';
        const details = [engStr, freqStr, trendStr].filter(Boolean).join(', ');
        lines.push(`- @${c.username}: ${c.followersCount.toLocaleString()} followers${details ? ` (${details})` : ''}`);

        if (c.topHashtags?.length) {
            lines.push(`  Top hashtags: ${c.topHashtags.slice(0, 5).map(h => `#${h.tag}`).join(', ')}`);
        }
        if (c.bestPost) {
            lines.push(`  Best post: "${c.bestPost.caption.slice(0, 60)}..." (${(c.bestPost.engagementRate * 100).toFixed(1)}% engagement)`);
        }

        // Extract treatment keywords from competitor posts
        if (c.recentPosts) {
            for (const post of c.recentPosts) {
                const captionLower = (post.caption || '').toLowerCase();
                for (const sk of SERVICE_KEYWORDS) {
                    if (captionLower.includes(sk.keyword)) {
                        competitorTopicSet.add(sk.keyword);
                    }
                }
            }
        }
    }

    // Compute gaps vs competitors
    const competitorGaps: string[] = [];
    for (const kw of competitorTopicSet) {
        const label = SERVICE_KEYWORDS.find(s => s.keyword === kw)?.label || kw;
        if (neverPostedSet.has(kw)) {
            competitorGaps.push(`${label} (competitors post about this, you NEVER have)`);
        } else {
            const days = contentGapMap.get(kw);
            if (days && days >= 30) {
                competitorGaps.push(`${label} (competitors post about this, your last post was ${days}d ago)`);
            }
        }
    }

    if (competitorGaps.length > 0) {
        lines.push(`\nCONTENT GAPS VS COMPETITORS (they cover these, you don't):`);
        competitorGaps.forEach(g => lines.push(`- ${g}`));
    }

    return { context: lines.join('\n'), competitorTopicSet };
}

export async function POST(req: Request) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!ANTHROPIC_API_KEY) {
        return NextResponse.json({ error: 'AI service not configured (ANTHROPIC_API_KEY missing)' }, { status: 503 });
    }

    try {
        const body = await req.json();
        const { month, year, focus = 'all' } = body;

        if (!month || !year) {
            return NextResponse.json({ error: 'month and year are required' }, { status: 400 });
        }

        // ── Fetch ALL data sources in parallel ──
        const keywordArray = SERVICE_KEYWORDS.map(s => s.keyword);

        const [
            topPostsRes,
            searchQueriesRes,
            treatmentTrendsRes,
            reviewsRes,
            leadSourcesRes,
            contentGapsRes,
            formatPerfRes,
            adThemesRes,
            revenueRes,
            feedbackRes,
            competitorsResult,
        ] = await Promise.allSettled([
            // 1. Top posts by engagement
            sql`
                SELECT caption, platform, likes, comments, shares, views, engagement_rate
                FROM social_posts
                WHERE posted_at > NOW() - INTERVAL '90 days'
                ORDER BY engagement_rate DESC NULLS LAST
                LIMIT 10
            `,
            // 2. Search Console queries
            sql`
                SELECT query, SUM(clicks)::int as total_clicks, SUM(impressions)::int as total_impressions
                FROM search_console_daily
                WHERE metric_date > CURRENT_DATE - 60
                GROUP BY query
                ORDER BY total_clicks DESC
                LIMIT 15
            `,
            // 3. Treatment booking trends — this month vs last month
            sql`
                SELECT session_type_name AS treatment,
                    COUNT(CASE WHEN start_date >= DATE_TRUNC('month', CURRENT_DATE) THEN 1 END)::int AS this_month,
                    COUNT(CASE WHEN start_date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month'
                               AND start_date < DATE_TRUNC('month', CURRENT_DATE) THEN 1 END)::int AS last_month
                FROM mb_appointments_history
                WHERE start_date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month'
                    AND status IN ('Completed', 'Confirmed') AND session_type_name IS NOT NULL
                GROUP BY session_type_name ORDER BY this_month DESC LIMIT 15
            `,
            // 4. Patient review themes
            sql`
                SELECT rating, SUBSTRING(review_text FROM 1 FOR 200) AS excerpt
                FROM reviews
                WHERE review_date > NOW() - INTERVAL '180 days'
                    AND review_text IS NOT NULL AND LENGTH(review_text) > 50
                ORDER BY review_date DESC LIMIT 15
            `,
            // 5. Conversion-qualified lead sources (GHL → MindBody 3-table join)
            sql`
                WITH ghl_recent AS (
                    SELECT contact_id, LOWER(email) AS email, phone_normalized,
                           REPLACE((tags->0)::text, '"', '') AS source
                    FROM ghl_contacts_map
                    WHERE created_at >= NOW() - INTERVAL '90 days'
                ),
                client_match AS (
                    SELECT g.contact_id, g.source,
                           COALESCE(em.client_id, pm.client_id) AS mb_client_id
                    FROM ghl_recent g
                    LEFT JOIN mb_clients_cache em ON LOWER(em.email) = g.email AND g.email IS NOT NULL AND g.email != ''
                    LEFT JOIN mb_clients_cache pm ON pm.phone = g.phone_normalized
                        AND g.phone_normalized IS NOT NULL AND LENGTH(g.phone_normalized) = 10
                        AND em.client_id IS NULL
                ),
                booked AS (
                    SELECT DISTINCT client_id FROM mb_appointments_history
                    WHERE start_date >= NOW() - INTERVAL '90 days' AND status IN ('Completed', 'Confirmed')
                )
                SELECT cm.source,
                    COUNT(DISTINCT cm.contact_id)::int AS total_leads,
                    COUNT(DISTINCT CASE WHEN b.client_id IS NOT NULL THEN cm.contact_id END)::int AS leads_who_booked,
                    ROUND(100.0 * COUNT(DISTINCT CASE WHEN b.client_id IS NOT NULL THEN cm.contact_id END)
                        / NULLIF(COUNT(DISTINCT cm.contact_id), 0), 1) AS conversion_pct
                FROM client_match cm
                LEFT JOIN booked b ON b.client_id = cm.mb_client_id
                WHERE cm.source IS NOT NULL AND cm.source != ''
                GROUP BY cm.source ORDER BY leads_who_booked DESC LIMIT 10
            `,
            // 6. Content gap analysis — days since last post per service keyword
            sql`
                SELECT kw AS keyword,
                    MAX(posted_at) AS last_posted,
                    EXTRACT(DAY FROM NOW() - MAX(posted_at))::int AS days_since
                FROM social_posts,
                    unnest(string_to_array(${keywordArray.join(',')}, ',')) AS kw
                WHERE LOWER(caption) LIKE '%' || kw || '%'
                    AND posted_at > NOW() - INTERVAL '365 days'
                GROUP BY kw ORDER BY days_since DESC
            `,
            // 7. Format performance breakdown
            sql`
                SELECT post_type, COUNT(*)::int AS total,
                    ROUND(AVG(engagement_rate)::numeric, 4) AS avg_engagement,
                    ROUND(AVG(views)::numeric, 0) AS avg_views,
                    ROUND(AVG(saves)::numeric, 1) AS avg_saves
                FROM social_posts
                WHERE posted_at > NOW() - INTERVAL '90 days' AND post_type IS NOT NULL
                GROUP BY post_type ORDER BY avg_engagement DESC
            `,
            // 8. Top ad campaign themes
            sql`
                SELECT c.campaign_name, c.objective, SUM(m.leads)::int AS total_leads,
                    ROUND(AVG(m.cost_per_lead)::numeric, 2) AS avg_cpl
                FROM ad_campaigns c
                JOIN ad_metrics_daily m ON c.campaign_id = m.campaign_id AND c.platform = m.platform
                WHERE m.metric_date > CURRENT_DATE - 30 AND m.leads > 0
                GROUP BY c.campaign_name, c.objective ORDER BY total_leads DESC LIMIT 5
            `,
            // 9. Treatment revenue — top earners from MindBody sales (for revenue flags)
            sql`
                SELECT
                    item->>'Description' AS treatment_name,
                    SUM((item->>'TotalAmount')::numeric)::numeric(10,2) AS total_revenue,
                    COUNT(DISTINCT sale_id)::int AS sale_count
                FROM mb_sales_history,
                    jsonb_array_elements(items_json) AS item
                WHERE sale_date >= CURRENT_DATE - 365
                    AND (item->>'TotalAmount')::numeric > 0
                GROUP BY treatment_name
                ORDER BY total_revenue DESC
                LIMIT 20
            `,
            // 10. Performance feedback — how past suggested topics performed
            sql`
                SELECT
                    cp.metadata::json->>'topic' AS topic,
                    cp.published_at,
                    sp.engagement_rate,
                    sp.likes,
                    sp.comments,
                    sp.views
                FROM content_posts cp
                LEFT JOIN social_posts sp
                    ON sp.caption ILIKE '%' || LEFT(cp.caption, 40) || '%'
                    AND sp.posted_at > cp.published_at - INTERVAL '2 days'
                    AND sp.posted_at < cp.published_at + INTERVAL '2 days'
                WHERE cp.metadata::text LIKE '%research_calendar%'
                    AND cp.status = 'PUBLISHED'
                    AND cp.published_at > NOW() - INTERVAL '60 days'
                ORDER BY sp.engagement_rate DESC NULLS LAST
                LIMIT 20
            `,
            // 11. Competitor IG data (4h cache, 0 API cost when warm)
            getIGCompetitorMetrics(),
        ]);

        // ── Build context strings from each source ──

        // 1. Top posts
        const topPosts = topPostsRes.status === 'fulfilled' ? topPostsRes.value.rows : [];
        const topPostsContext = topPosts.length > 0
            ? `YOUR TOP-PERFORMING RECENT POSTS (last 90 days):\n${topPosts.map(p =>
                `- [${p.platform}] "${(p.caption || '').slice(0, 80)}..." (${p.likes} likes, ${p.comments} comments, ${(Number(p.engagement_rate) * 100).toFixed(1)}% engagement)`
            ).join('\n')}`
            : '';

        // 2. Search queries
        const searchQueries = searchQueriesRes.status === 'fulfilled' ? searchQueriesRes.value.rows : [];
        const searchContext = searchQueries.length > 0
            ? `TOP GOOGLE SEARCH QUERIES driving traffic:\n${searchQueries.map(q =>
                `- "${q.query}" (${q.total_clicks} clicks, ${q.total_impressions} impressions)`
            ).join('\n')}`
            : '';

        // Build search demand map for scoring
        const searchDemandMap = new Map<string, { clicks: number; impressions: number }>();
        for (const q of searchQueries) {
            const queryLower = (q.query || '').toLowerCase();
            for (const sk of SERVICE_KEYWORDS) {
                if (queryLower.includes(sk.keyword)) {
                    const existing = searchDemandMap.get(sk.keyword) || { clicks: 0, impressions: 0 };
                    existing.clicks += Number(q.total_clicks) || 0;
                    existing.impressions += Number(q.total_impressions) || 0;
                    searchDemandMap.set(sk.keyword, existing);
                }
            }
        }

        // 3. Treatment booking trends
        const treatments = treatmentTrendsRes.status === 'fulfilled' ? treatmentTrendsRes.value.rows : [];
        const treatmentContext = treatments.length > 0
            ? `TREATMENT BOOKING TRENDS (this month vs last month):\n${treatments.map(t => {
                const thisMonth = Number(t.this_month) || 0;
                const lastMonth = Number(t.last_month) || 0;
                const pctChange = lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : (thisMonth > 0 ? 100 : 0);
                const arrow = pctChange > 0 ? `+${pctChange}%` : pctChange < 0 ? `${pctChange}%` : 'flat';
                return `- ${t.treatment}: ${thisMonth} bookings (${arrow} vs last month)`;
            }).join('\n')}`
            : '';

        // 4. Patient review themes
        const reviews = reviewsRes.status === 'fulfilled' ? reviewsRes.value.rows : [];
        const reviewContext = reviews.length > 0
            ? `RECENT PATIENT REVIEWS (use these themes/language for authentic content):\n${reviews.map(r =>
                `- [${r.rating}★] "${r.excerpt}"`
            ).join('\n')}`
            : '';

        // 5. Conversion-qualified lead sources
        const leadSources = leadSourcesRes.status === 'fulfilled' ? leadSourcesRes.value.rows : [];
        const leadContext = leadSources.length > 0
            ? `LEAD SOURCE CONVERSION (which channels produce actual patients, not just inquiries):\n${leadSources.map(s =>
                `- ${s.source}: ${s.total_leads} leads → ${s.leads_who_booked} booked (${s.conversion_pct}% conversion)`
            ).join('\n')}`
            : '';

        // 6. Content gaps
        const contentGaps = contentGapsRes.status === 'fulfilled' ? contentGapsRes.value.rows : [];
        const postedKeywords = new Set(contentGaps.map(g => g.keyword));
        const neverPostedSet = new Set(
            SERVICE_KEYWORDS.filter(s => !postedKeywords.has(s.keyword)).map(s => s.keyword)
        );
        const neverPosted = SERVICE_KEYWORDS
            .filter(s => neverPostedSet.has(s.keyword))
            .map(s => s.label);
        const staleKeywords = contentGaps
            .filter(g => Number(g.days_since) >= 60)
            .map(g => {
                const meta = SERVICE_KEYWORDS.find(s => s.keyword === g.keyword);
                return `${meta?.label || g.keyword} (${g.days_since}d ago)`;
            });
        const gapContext = (neverPosted.length > 0 || staleKeywords.length > 0)
            ? `CONTENT GAPS (services with no recent content — create posts about these!):\n${
                neverPosted.length > 0 ? `Never posted about: ${neverPosted.join(', ')}\n` : ''
            }${staleKeywords.length > 0 ? `Not posted in 60+ days: ${staleKeywords.join(', ')}` : ''}`
            : '';

        // Build content gap map for scoring
        const contentGapMap = new Map<string, number>();
        for (const g of contentGaps) {
            contentGapMap.set(g.keyword, Number(g.days_since) || 0);
        }

        // 7. Format performance
        const formatPerf = formatPerfRes.status === 'fulfilled' ? formatPerfRes.value.rows : [];
        const formatContext = formatPerf.length > 0
            ? `FORMAT PERFORMANCE (your best-performing post types):\n${formatPerf.map(f =>
                `- ${(f.post_type || 'unknown').toUpperCase()}: ${(Number(f.avg_engagement) * 100).toFixed(1)}% avg engagement (${f.total} posts, ${f.avg_views} avg views, ${f.avg_saves} avg saves)`
            ).join('\n')}`
            : '';

        // Build format perf map for scoring
        const formatPerfMap = new Map<string, number>();
        for (const f of formatPerf) {
            formatPerfMap.set((f.post_type || '').toLowerCase(), Number(f.avg_engagement) || 0);
        }

        // 8. Ad campaign themes
        const adThemes = adThemesRes.status === 'fulfilled' ? adThemesRes.value.rows : [];
        const adContext = adThemes.length > 0
            ? `TOP CONVERTING AD CAMPAIGNS (align organic content with winning paid themes):\n${adThemes.map(a =>
                `- "${a.campaign_name}" (${a.total_leads} leads, $${a.avg_cpl} CPL)`
            ).join('\n')}`
            : '';

        // 9. Revenue data — build map for flags only (not for AI context)
        const revenueRows = revenueRes.status === 'fulfilled' ? revenueRes.value.rows : [];
        const revenueMap = new Map<string, number>();
        const topRevenueKeywords = new Set<string>();
        for (const r of revenueRows) {
            const name = (r.treatment_name || '').toLowerCase();
            for (const sk of SERVICE_KEYWORDS) {
                if (name.includes(sk.keyword)) {
                    const existing = revenueMap.get(sk.keyword) || 0;
                    revenueMap.set(sk.keyword, existing + Number(r.total_revenue));
                }
            }
        }
        // Top 10 by revenue
        const sortedRevenue = [...revenueMap.entries()].sort((a, b) => b[1] - a[1]);
        for (const [kw] of sortedRevenue.slice(0, 10)) {
            topRevenueKeywords.add(kw);
        }

        // 10. Performance feedback
        const feedbackRows = feedbackRes.status === 'fulfilled' ? feedbackRes.value.rows : [];
        const publishedFromTrends = feedbackRows.filter(r => r.topic);
        const withEngagement = publishedFromTrends.filter(r => r.engagement_rate != null);
        const avgEngagement = withEngagement.length > 0
            ? withEngagement.reduce((sum, r) => sum + Number(r.engagement_rate), 0) / withEngagement.length
            : 0;
        const topPerformer = withEngagement.length > 0 ? withEngagement[0] : null; // already sorted DESC
        const feedbackSummary = {
            publishedCount: publishedFromTrends.length,
            totalSuggested: 10,
            topPerformer: topPerformer ? {
                topic: topPerformer.topic,
                engagement: Number(topPerformer.engagement_rate) || 0,
                views: Number(topPerformer.views) || 0,
            } : null,
            avgEngagement,
        };

        const feedbackContext = publishedFromTrends.length > 0
            ? `FEEDBACK FROM PREVIOUS SUGGESTIONS (learn from what worked):\n${
                withEngagement.slice(0, 5).map(r =>
                    `- "${r.topic}" → ${(Number(r.engagement_rate) * 100).toFixed(1)}% engagement, ${r.views} views`
                ).join('\n')
            }\n${publishedFromTrends.length} of your last batch were published.${
                topPerformer ? ` Top performer: "${topPerformer.topic}"` : ''
            }`
            : '';

        // 11. Competitor data
        const competitors = competitorsResult.status === 'fulfilled' ? competitorsResult.value : [];
        const { context: competitorContext, competitorTopicSet } = buildCompetitorContext(
            competitors, contentGapMap, neverPostedSet
        );

        // ── Build the enhanced prompt ──

        const seasonContext = SEASONAL_CONTEXT[month] || '';

        const focusInstruction = focus !== 'all'
            ? `Focus specifically on ${focus} content.`
            : 'Include a mix of treatments, promotions, educational, and lifestyle content.';

        // Combine all data sections (skip empty ones)
        const dataSections = [
            topPostsContext,
            searchContext,
            treatmentContext,
            reviewContext,
            leadContext,
            gapContext,
            formatContext,
            adContext,
            competitorContext,
            feedbackContext,
        ].filter(Boolean).join('\n\n');

        const prompt = `You are a social media strategist for Chin Up Aesthetics, a premium medical spa in Atlanta, GA.

BUSINESS CONTEXT:
- Top treatments: Dysport, Restylane fillers, Sculptra, midface procedures, Emsculpt Neo
- Growing categories: weight loss (semaglutide, tirzepatide), body sculpting
- Retail skincare: SkinBetter, Plated, Hydrinity
- Target audience: Women 25-55 in metro Atlanta, professionals who value self-care
- Platforms: Instagram (primary), Facebook, YouTube
- Tone: Professional yet warm, empowering, educational but accessible

TASK: Generate 10 high-priority content topic ideas for ${MONTH_NAMES[month - 1]} ${year}.

${focusInstruction}

SEASONAL CONTEXT FOR ${MONTH_NAMES[month - 1].toUpperCase()}:
${seasonContext}

=== YOUR REAL BUSINESS DATA ===

${dataSections || 'No historical data available yet.'}

=== END DATA ===

INSTRUCTIONS:
For each topic, provide:
1. title: A specific, actionable content topic (not generic)
2. platform: Best platform for this topic (Instagram, Facebook, YouTube, or All)
3. format: Best format (Reel, Post, Carousel, Story, YouTube Short, YouTube Video)
4. hook: The first 1-2 sentences of the post — the scroll-stopper that makes people stop and watch/read. Write it as if it's the actual opening line of the post.
5. suggested_cta: A specific call-to-action for the end of the post. Must reference a treatment or booking action. Examples: "Book your Dysport consultation → link in bio", "DM us 'GLOW' for our spring facial package"
6. rationale: One sentence explaining why this will perform well — CITE THE DATA above
7. content_intent: Either "reach" (designed to get views and grow audience) or "convert" (designed to drive bookings and consultations)
8. category: One of: treatment, promotion, educational, lifestyle

CRITICAL RULES:
- Make topics SPECIFIC to med spa / aesthetics (not generic social media advice)
- Reference actual treatments from your data — especially trending-UP treatments and content gaps
- Include topics for any content gaps identified above (services with no recent posts)
- If competitor data is available, create content that fills gaps vs competitors
- Use format recommendations based on YOUR format performance data
- If review themes are available, craft content inspired by real patient language
- Include a mix of "reach" and "convert" content_intent (aim for ~4 reach, ~6 convert)
- At least 5 topics should directly reference treatments by name
- Include 2-3 promotional angles tied to seasonal events
- Every suggested_cta must be specific and actionable (not generic like "follow us")
- NEVER include revenue figures, dollar amounts, or internal business metrics. Say "top-performing service" not "$625K/yr". Say "trending up this month" not "+15% bookings".
- If feedback data shows which past topics performed well, lean into similar themes

Return ONLY a valid JSON array of objects. No markdown, no explanation, no code fences.
Format: [{"title":"...","platform":"...","format":"...","hook":"...","suggested_cta":"...","rationale":"...","content_intent":"reach","category":"treatment"}]`;

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 4096,
                messages: [{ role: 'user', content: prompt }],
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[research/trends] Anthropic API error:', response.status, errorText);
            return NextResponse.json({ error: 'AI service error' }, { status: 502 });
        }

        const data = await response.json();
        const text = data.content?.[0]?.text || '[]';

        let topics: any[];
        try {
            const cleaned = text.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim();
            topics = JSON.parse(cleaned);
            if (!Array.isArray(topics)) topics = [];
        } catch {
            console.error('[research/trends] Failed to parse AI response:', text.slice(0, 200));
            return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 502 });
        }

        // ── Score and enrich each topic ──

        const scoringInputs: OpportunityInputs = {
            searchDemandMap,
            contentGapMap,
            neverPostedSet,
            formatPerfMap,
            competitorTopicSet,
            revenueMap,
            topRevenueKeywords,
        };

        const enrichedTopics = topics.map(t => ({
            ...t,
            opportunity_score: computeOpportunityScore(t, scoringInputs),
            money_maker_alert: computeMoneyMakerAlert(t, scoringInputs),
            booking_url: findBookingUrl(t),
        }));

        // Sort by opportunity score descending
        enrichedTopics.sort((a, b) => b.opportunity_score - a.opportunity_score);

        // Save to DB
        const userEmail = session.user.email;
        await sql`
            INSERT INTO research_trends (month, year, focus, trends_data, created_by)
            VALUES (${month}, ${year}, ${focus}, ${JSON.stringify(enrichedTopics)}, ${userEmail})
        `.catch(e => console.error('[research/trends] DB save error:', e));

        // Track usage
        const monthKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
        await sql`
            INSERT INTO api_usage_monthly (api_name, month_key, total_calls)
            VALUES ('research_trends', ${monthKey}, 1)
            ON CONFLICT (api_name, month_key)
            DO UPDATE SET total_calls = api_usage_monthly.total_calls + 1
        `.catch(() => {});

        return NextResponse.json({
            topics: enrichedTopics,
            count: enrichedTopics.length,
            feedback: feedbackSummary,
        });
    } catch (error: any) {
        console.error('[research/trends] Error:', error);
        return NextResponse.json({ error: error.message || 'Trend generation failed' }, { status: 500 });
    }
}
