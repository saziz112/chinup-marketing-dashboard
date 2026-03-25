/**
 * POST /api/research/trends
 * Generate AI-powered trending topic ideas for content planning.
 * Uses Claude Haiku + 8 real data sources from Postgres for maximum context.
 *
 * Data Sources (all Postgres, $0 API cost):
 *   1. Top 10 posts by engagement (social_posts)
 *   2. Top 15 Search Console queries (search_console_daily)
 *   3. Treatment booking trends — this month vs last month (mb_appointments_history)
 *   4. Patient review themes — recent 5-star reviews (reviews)
 *   5. Conversion-qualified lead sources — GHL→MindBody match (3-table join)
 *   6. Content gap analysis — 40 service keywords (social_posts)
 *   7. Format performance breakdown — avg engagement by post_type (social_posts)
 *   8. Top ad campaign themes (ad_campaigns + ad_metrics_daily)
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sql } from '@vercel/postgres';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

// Seasonal context per month
const SEASONAL_CONTEXT: Record<number, string> = {
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

// Full service keyword map from MindBody product catalog ($2.1M revenue)
const SERVICE_KEYWORDS = [
    // Neurotoxins ($797K)
    { keyword: 'botox', label: 'Botox ($172K)' },
    { keyword: 'dysport', label: 'Dysport ($625K — #1 revenue)' },
    { keyword: 'hyperhidrosis', label: 'Hyperhidrosis' },
    // Dermal Fillers — Restylane ($687K)
    { keyword: 'restylane', label: 'Restylane ($687K)' },
    { keyword: 'lip filler', label: 'Lip Filler ($101K)' },
    { keyword: 'midface', label: 'Midface ($291K)' },
    { keyword: 'chin filler', label: 'Chin Filler ($135K)' },
    { keyword: 'cheek filler', label: 'Cheek Filler ($113K)' },
    { keyword: 'under eye filler', label: 'Under-Eye Filler ($21K)' },
    { keyword: 'profile balancing', label: 'Profile Balancing' },
    { keyword: 'sculptra', label: 'Sculptra ($159K)' },
    { keyword: 'juvederm', label: 'Juvederm' },
    // Dissolving / Contouring
    { keyword: 'kybella', label: 'Kybella ($16K)' },
    { keyword: 'hylenex', label: 'Filler Dissolving ($8K)' },
    { keyword: 'double chin', label: 'Double Chin' },
    { keyword: 'platysmal', label: 'Platysmal Bands' },
    // PRP & Growth Factors
    { keyword: 'prp', label: 'PRP ($3.4K)' },
    { keyword: 'pdgf', label: 'PDGF ($10K)' },
    { keyword: 'exosome', label: 'Exosomes' },
    { keyword: 'hair rejuvenation', label: 'Hair Rejuvenation' },
    // Skin Treatments
    { keyword: 'hydrafacial', label: 'HydraFacial ($21K)' },
    { keyword: 'keravive', label: 'Keravive (Scalp)' },
    { keyword: 'microneedling', label: 'Microneedling ($37K)' },
    { keyword: 'rf microneedling', label: 'RF Microneedling ($3.4K)' },
    { keyword: 'vi peel', label: 'VI Peel ($24K)' },
    { keyword: 'cool peel', label: 'Cool Peel ($11K)' },
    { keyword: 'chemical peel', label: 'Chemical Peel' },
    { keyword: 'dermaplaning', label: 'Dermaplaning ($3.6K)' },
    // Body
    { keyword: 'emsculpt', label: 'Emsculpt Neo ($91K)' },
    { keyword: 'emsella', label: 'Emsella ($4.3K)' },
    { keyword: 'body sculpt', label: 'Body Sculpting' },
    { keyword: 'hair removal', label: 'Laser Hair Removal ($37K)' },
    // Weight Loss / Wellness
    { keyword: 'semaglutide', label: 'Semaglutide ($12.6K)' },
    { keyword: 'tirzepatide', label: 'Tirzepatide ($5.7K)' },
    { keyword: 'weight loss', label: 'Weight Loss' },
    { keyword: 'b12', label: 'MIC B12 ($1.5K)' },
    { keyword: 'iv therapy', label: 'IV Therapy ($1.7K)' },
    // Retail / Skincare
    { keyword: 'skinbetter', label: 'SkinBetter ($25K+)' },
    { keyword: 'hydrinity', label: 'Hydrinity ($22K+)' },
    { keyword: 'plated', label: 'Plated Skin Science ($33K+)' },
    { keyword: 'zo skin', label: 'ZO Skin Health' },
];

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

        // ── Fetch ALL 8 data sources in parallel ──
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
        ] = await Promise.allSettled([
            // 1. Top posts by engagement (existing)
            sql`
                SELECT caption, platform, likes, comments, shares, views, engagement_rate
                FROM social_posts
                WHERE posted_at > NOW() - INTERVAL '90 days'
                ORDER BY engagement_rate DESC NULLS LAST
                LIMIT 10
            `,
            // 2. Search Console queries (existing)
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
            // 4. Patient review themes — recent substantive reviews
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
            // Pass keywords as comma-separated string → string_to_array for Postgres
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
        const neverPosted = SERVICE_KEYWORDS
            .filter(s => !postedKeywords.has(s.keyword))
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

        // 7. Format performance
        const formatPerf = formatPerfRes.status === 'fulfilled' ? formatPerfRes.value.rows : [];
        const formatContext = formatPerf.length > 0
            ? `FORMAT PERFORMANCE (your best-performing post types):\n${formatPerf.map(f =>
                `- ${(f.post_type || 'unknown').toUpperCase()}: ${(Number(f.avg_engagement) * 100).toFixed(1)}% avg engagement (${f.total} posts, ${f.avg_views} avg views, ${f.avg_saves} avg saves)`
            ).join('\n')}`
            : '';

        // 8. Ad campaign themes
        const adThemes = adThemesRes.status === 'fulfilled' ? adThemesRes.value.rows : [];
        const adContext = adThemes.length > 0
            ? `TOP CONVERTING AD CAMPAIGNS (align organic content with winning paid themes):\n${adThemes.map(a =>
                `- "${a.campaign_name}" (${a.total_leads} leads, $${a.avg_cpl} CPL)`
            ).join('\n')}`
            : '';

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
        ].filter(Boolean).join('\n\n');

        const prompt = `You are a social media strategist for Chin Up Aesthetics, a premium medical spa in Atlanta, GA.

BUSINESS CONTEXT:
- #1 revenue service: Dysport ($625K/yr) — NOT Botox ($172K). Feature Dysport prominently.
- Top fillers: Restylane line ($687K), Sculptra ($159K), midface procedures ($291K)
- Growing categories: Emsculpt Neo ($91K), weight loss (semaglutide $12.6K, tirzepatide $5.7K)
- Retail skincare: SkinBetter ($25K+), Plated ($33K+), Hydrinity ($22K+)
- Target audience: Women 25-55 in metro Atlanta, professionals who value self-care
- Platforms: Instagram (primary), Facebook, YouTube
- Tone: Professional yet warm, empowering, educational but accessible

TASK: Generate 25 trending content topic ideas for ${MONTH_NAMES[month - 1]} ${year}.

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
4. rationale: One sentence explaining why this will perform well — CITE THE DATA above (mention specific numbers, treatments, or trends)
5. potential: Engagement potential rating (High, Medium, or Low)
6. category: One of: treatment, promotion, educational, lifestyle

CRITICAL RULES:
- Make topics SPECIFIC to med spa / aesthetics (not generic social media advice)
- Reference actual treatments from your data — especially trending-UP treatments and content gaps
- Feature Dysport at least twice (it's your #1 revenue driver at $625K/yr)
- Include topics for any content gaps identified above (services with no recent posts)
- Use format recommendations based on YOUR format performance data
- If review themes are available, craft content inspired by real patient language
- Consider which lead sources convert best when recommending content strategy
- Include a mix of engagement potential levels (not all High)
- At least 8 topics should directly reference treatments by name
- Include 4-5 promotional angles tied to seasonal events
- Include 3-4 topics for services that haven't been posted about recently

Return ONLY a valid JSON array of objects. No markdown, no explanation, no code fences.
Format: [{"title":"...","platform":"...","format":"...","rationale":"...","potential":"High","category":"treatment"}]`;

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

        // Save to DB
        const userEmail = session.user.email;
        await sql`
            INSERT INTO research_trends (month, year, focus, trends_data, created_by)
            VALUES (${month}, ${year}, ${focus}, ${JSON.stringify(topics)}, ${userEmail})
        `.catch(e => console.error('[research/trends] DB save error:', e));

        // Track usage
        const monthKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
        await sql`
            INSERT INTO api_usage_monthly (api_name, month_key, total_calls)
            VALUES ('research_trends', ${monthKey}, 1)
            ON CONFLICT (api_name, month_key)
            DO UPDATE SET total_calls = api_usage_monthly.total_calls + 1
        `.catch(() => {});

        return NextResponse.json({ topics, count: topics.length });
    } catch (error: any) {
        console.error('[research/trends] Error:', error);
        return NextResponse.json({ error: error.message || 'Trend generation failed' }, { status: 500 });
    }
}
