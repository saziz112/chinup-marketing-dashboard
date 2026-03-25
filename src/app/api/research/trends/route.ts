/**
 * POST /api/research/trends
 * Generate AI-powered trending topic ideas for content planning.
 * Uses Claude Haiku + existing dashboard performance data for context.
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

        // Gather context from existing dashboard data
        const [topPostsRes, searchQueriesRes] = await Promise.allSettled([
            sql`
                SELECT caption, platform, likes, comments, shares, views, engagement_rate
                FROM social_posts
                WHERE posted_at > NOW() - INTERVAL '90 days'
                ORDER BY engagement_rate DESC NULLS LAST
                LIMIT 10
            `,
            sql`
                SELECT query, SUM(clicks) as total_clicks, SUM(impressions) as total_impressions
                FROM search_console_daily
                WHERE metric_date > CURRENT_DATE - 60
                GROUP BY query
                ORDER BY total_clicks DESC
                LIMIT 15
            `,
        ]);

        const topPosts = topPostsRes.status === 'fulfilled' ? topPostsRes.value.rows : [];
        const searchQueries = searchQueriesRes.status === 'fulfilled' ? searchQueriesRes.value.rows : [];

        // Build context strings
        const topPostsContext = topPosts.length > 0
            ? `Your top-performing recent posts:\n${topPosts.map(p =>
                `- [${p.platform}] "${(p.caption || '').slice(0, 80)}..." (${p.likes} likes, ${p.comments} comments, ${(Number(p.engagement_rate) * 100).toFixed(1)}% engagement)`
            ).join('\n')}`
            : 'No recent post performance data available.';

        const searchContext = searchQueries.length > 0
            ? `Top Google Search queries driving traffic to your site:\n${searchQueries.map(q =>
                `- "${q.query}" (${q.total_clicks} clicks, ${q.total_impressions} impressions)`
            ).join('\n')}`
            : '';

        const seasonContext = SEASONAL_CONTEXT[month] || '';

        const focusInstruction = focus !== 'all'
            ? `Focus specifically on ${focus} content.`
            : 'Include a mix of treatments, promotions, educational, and lifestyle content.';

        const prompt = `You are a social media strategist for Chin Up Aesthetics, a premium medical spa in Atlanta, GA.

BUSINESS CONTEXT:
- Treatments offered: Botox, dermal fillers (lips, cheeks, jawline), microneedling, hydrafacials, chemical peels, laser treatments, midface procedures, body contouring
- Target audience: Women 25-55 in metro Atlanta, professionals who value self-care
- Platforms: Instagram (primary), Facebook, YouTube
- Tone: Professional yet warm, empowering, educational but accessible

TASK: Generate 25 trending content topic ideas for ${MONTH_NAMES[month - 1]} ${year}.

${focusInstruction}

SEASONAL CONTEXT FOR ${MONTH_NAMES[month - 1].toUpperCase()}:
${seasonContext}

${topPostsContext}

${searchContext}

For each topic, provide:
1. title: A specific, actionable content topic (not generic)
2. platform: Best platform for this topic (Instagram, Facebook, YouTube, or All)
3. format: Best format (Reel, Post, Carousel, Story, YouTube Short, YouTube Video)
4. rationale: One sentence explaining why this will perform well
5. potential: Engagement potential rating (High, Medium, or Low)
6. category: One of: treatment, promotion, educational, lifestyle

IMPORTANT:
- Make topics SPECIFIC to med spa / aesthetics (not generic social media advice)
- Reference actual treatments and seasonal events
- Consider what formats get the most engagement on each platform (Reels/Shorts for discovery, Carousels for saves, Stories for engagement)
- Include a mix of engagement potential levels (not all High)
- At least 5 topics should directly reference treatments by name
- Include 3-4 promotional angles

Return ONLY a valid JSON array of objects. No markdown, no explanation, no code fences.
Example format: [{"title":"...","platform":"...","format":"...","rationale":"...","potential":"High","category":"treatment"}]`;

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
            // Strip any markdown code fences if present
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
