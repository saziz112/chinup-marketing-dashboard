/**
 * POST /api/research/calendar
 * Generate AI-powered monthly content calendar.
 * Now data-informed: queries treatment trends, content gaps, format performance
 * + accepts full topic objects with opportunity scores from Trend Scout.
 * Every caption includes a CTA with booking link placeholder.
 *
 * GET /api/research/calendar?month=4&year=2026
 * Load a previously saved calendar.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sql } from '@vercel/postgres';
import { MONTH_NAMES, SEASONAL_CONTEXT, SERVICE_KEYWORDS } from '../trends/route';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const KEY_DATES: Record<number, string[]> = {
    1: ['Jan 1 - New Year\'s Day'],
    2: ['Feb 14 - Valentine\'s Day', 'Feb - Black History Month'],
    3: ['Mar 8 - International Women\'s Day', 'Mar - Women\'s History Month'],
    4: ['Apr 5 - Easter (2026)', 'Apr 22 - Earth Day', 'Apr - Skin Cancer Awareness Month', 'Prom season / Wedding prep'],
    5: ['May 10 - Mother\'s Day (2026)', 'May - Melanoma Awareness Month', 'Graduation season'],
    6: ['Jun 21 - Father\'s Day (2026)', 'Jun - Wedding season peak'],
    7: ['Jul 4 - Independence Day'],
    8: ['Back-to-school season begins'],
    9: ['Sep - Self-Care Awareness Month', 'Laser season begins'],
    10: ['Oct 31 - Halloween', 'Oct - Breast Cancer Awareness Month'],
    11: ['Nov - Black Friday/Cyber Monday deals', 'Nov - Movember / Friendsgiving'],
    12: ['Holiday party season', 'Dec 25 - Christmas', 'Dec 31 - New Year\'s Eve', 'Year-end gift cards'],
};

// MindBody booking links per treatment — shared with trends route
const BOOKING_LINKS: Record<string, string> = {
    '_default': 'https://www.chinupaesthetics.com/book',
};

function findBookingUrlForCaption(caption: string): string {
    const captionLower = caption.toLowerCase();
    for (const sk of SERVICE_KEYWORDS) {
        if (captionLower.includes(sk.keyword) && BOOKING_LINKS[sk.keyword]) {
            return BOOKING_LINKS[sk.keyword];
        }
    }
    return BOOKING_LINKS['_default'];
}

// GET /api/research/calendar?month=4&year=2026 — Load saved calendar
export async function GET(req: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const month = Number(req.nextUrl.searchParams.get('month'));
    const year = Number(req.nextUrl.searchParams.get('year'));
    if (!month || !year) {
        return NextResponse.json({ error: 'month and year required' }, { status: 400 });
    }

    try {
        const result = await sql`
            SELECT calendar_data, created_at FROM research_calendars
            WHERE month = ${month} AND year = ${year}
            ORDER BY created_at DESC LIMIT 1
        `;

        if (result.rows.length === 0) {
            return NextResponse.json({ saved: false });
        }

        const row = result.rows[0];
        const days = JSON.parse(row.calendar_data || '[]');
        return NextResponse.json({ saved: true, days, createdAt: row.created_at });
    } catch (error: any) {
        console.error('[research/calendar] GET error:', error);
        return NextResponse.json({ error: 'Failed to load saved calendar' }, { status: 500 });
    }
}

export async function POST(req: Request) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!ANTHROPIC_API_KEY) {
        return NextResponse.json({ error: 'AI service not configured' }, { status: 503 });
    }

    try {
        const body = await req.json();
        const { month, year, savedTopics, postsPerWeek } = body;

        if (!month || !year) {
            return NextResponse.json({ error: 'month and year are required' }, { status: 400 });
        }

        const daysInMonth = new Date(year, month, 0).getDate();
        const keyDates = KEY_DATES[month] || [];
        const weeklyTarget = postsPerWeek || 12;
        const seasonContext = SEASONAL_CONTEXT[month] || '';

        // ── Fetch real data context in parallel ──
        const keywordArray = SERVICE_KEYWORDS.map(s => s.keyword);

        const [treatmentTrendsRes, contentGapsRes, formatPerfRes] = await Promise.allSettled([
            // Treatment booking trends — this month vs last month
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
            // Content gap analysis
            sql`
                SELECT kw AS keyword,
                    EXTRACT(DAY FROM NOW() - MAX(posted_at))::int AS days_since
                FROM social_posts,
                    unnest(string_to_array(${keywordArray.join(',')}, ',')) AS kw
                WHERE LOWER(caption) LIKE '%' || kw || '%'
                    AND posted_at > NOW() - INTERVAL '365 days'
                GROUP BY kw ORDER BY days_since DESC
            `,
            // Format performance
            sql`
                SELECT post_type,
                    ROUND(AVG(engagement_rate)::numeric, 4) AS avg_engagement,
                    ROUND(AVG(views)::numeric, 0) AS avg_views
                FROM social_posts
                WHERE posted_at > NOW() - INTERVAL '90 days' AND post_type IS NOT NULL
                GROUP BY post_type ORDER BY avg_engagement DESC
            `,
        ]);

        // Build treatment trends context
        const treatments = treatmentTrendsRes.status === 'fulfilled' ? treatmentTrendsRes.value.rows : [];
        const treatmentDataContext = treatments.length > 0
            ? `TREATMENT BOOKING TRENDS (schedule trending-UP treatments more often):\n${treatments.slice(0, 10).map(t => {
                const thisMonth = Number(t.this_month) || 0;
                const lastMonth = Number(t.last_month) || 0;
                const pctChange = lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : (thisMonth > 0 ? 100 : 0);
                const arrow = pctChange > 0 ? `+${pctChange}%` : pctChange < 0 ? `${pctChange}%` : 'flat';
                return `- ${t.treatment}: ${arrow} vs last month`;
            }).join('\n')}`
            : '';

        // Build content gap context
        const contentGaps = contentGapsRes.status === 'fulfilled' ? contentGapsRes.value.rows : [];
        const postedKeywords = new Set(contentGaps.map(g => g.keyword));
        const neverPosted = SERVICE_KEYWORDS.filter(s => !postedKeywords.has(s.keyword)).map(s => s.label);
        const staleKeywords = contentGaps.filter(g => Number(g.days_since) >= 30).map(g => {
            const meta = SERVICE_KEYWORDS.find(s => s.keyword === g.keyword);
            return `${meta?.label || g.keyword} (${g.days_since}d ago)`;
        });
        const gapDataContext = (neverPosted.length > 0 || staleKeywords.length > 0)
            ? `CONTENT GAPS (prioritize scheduling these):\n${
                neverPosted.length > 0 ? `Never posted about: ${neverPosted.slice(0, 10).join(', ')}\n` : ''
            }${staleKeywords.length > 0 ? `Stale (30+ days): ${staleKeywords.slice(0, 10).join(', ')}` : ''}`
            : '';

        // Build format performance context
        const formatPerf = formatPerfRes.status === 'fulfilled' ? formatPerfRes.value.rows : [];
        const formatDataContext = formatPerf.length > 0
            ? `FORMAT PERFORMANCE (use your best-performing formats more often):\n${formatPerf.map(f =>
                `- ${(f.post_type || 'unknown').toUpperCase()}: ${(Number(f.avg_engagement) * 100).toFixed(1)}% avg engagement, ${f.avg_views} avg views`
            ).join('\n')}`
            : '';

        // Build topics context — now accepts full objects with scores
        let topicsContext = '';
        if (savedTopics?.length) {
            if (typeof savedTopics[0] === 'string') {
                // Legacy: array of title strings
                topicsContext = `PRIORITIZED TOPIC IDEAS:\n${savedTopics.map((t: string) => `- ${t}`).join('\n')}`;
            } else {
                // New: full topic objects with opportunity scores
                const sorted = [...savedTopics].sort((a: any, b: any) => (b.opportunity_score || 0) - (a.opportunity_score || 0));
                topicsContext = `PRIORITIZED TOPIC IDEAS (sorted by opportunity score — schedule higher-scored topics on Tue-Thu for peak engagement):\n${sorted.map((t: any) =>
                    `- [Score ${t.opportunity_score || '?'}] "${t.title}" (${t.format}, ${t.category})${t.content_intent === 'convert' ? ' [CONVERT]' : ' [REACH]'}`
                ).join('\n')}`;
            }
        }

        // Combine real data sections
        const dataSections = [treatmentDataContext, gapDataContext, formatDataContext].filter(Boolean).join('\n\n');

        const prompt = `You are a social media strategist for Chin Up Aesthetics, a premium medical spa in Atlanta, GA.

BUSINESS CONTEXT:
- Top treatments: Dysport, Restylane fillers, Sculptra, midface procedures, Emsculpt Neo
- Growing: semaglutide, tirzepatide, body sculpting
- Retail skincare: SkinBetter, Plated, Hydrinity
- Platforms: Instagram (IG), Facebook (FB), YouTube (YT)
- Target audience: Women 25-55, metro Atlanta, professionals
- Tone: Professional, warm, empowering

TASK: Create a detailed content calendar for ${MONTH_NAMES[month - 1]} ${year} (${daysInMonth} days).

KEY DATES THIS MONTH:
${keyDates.map(d => `- ${d}`).join('\n')}

SEASONAL CONTEXT:
${seasonContext}

${topicsContext}

=== YOUR REAL BUSINESS DATA ===

${dataSections || 'No data available yet — use general best practices.'}

=== END DATA ===

POSTING STRATEGY:
- Target ~${weeklyTarget} posts per week across all platforms
- Instagram: 3-4 per week (mix of Reels, Posts, Carousels)
- Facebook: 3 per week (Posts, shared Reels)
- YouTube: 1-2 per month (longer educational or before/after content)
- Not every day needs a post — rest days are OK
- Weekdays are better for educational content, weekends for lifestyle
- Best posting times: IG 9-11am + 7-9pm, FB 10am-2pm, YT anytime
- If prioritized topics are provided, schedule highest-scored topics on Tue-Thu

CONTENT MIX TARGETS:
- 40% treatment-focused (showcase services, before/after, how it works)
- 25% promotional (seasonal offers, bundles, event-based deals)
- 20% educational (skincare tips, myth-busting, what to expect)
- 15% lifestyle (team spotlights, patient stories, behind-the-scenes)

REQUIREMENTS:
- Generate one entry per posting day (skip some days for rest)
- Each entry needs: date, topic, platform, format, caption, hashtags, category
- EVERY caption MUST end with a clear call-to-action. Examples:
  - "Book your [treatment] consultation → link in bio"
  - "DM us '[KEYWORD]' to learn more"
  - "Tap the link in bio to schedule your appointment"
  - "Comment [emoji] if you want to try this!"
- Use [BOOKING_LINK] as a placeholder where the booking URL should go
- Caption should be ready to post (not a placeholder) — 2-3 sentences + CTA + 3-5 hashtags
- Reference key dates naturally
- Vary formats throughout the month based on format performance data

Return ONLY a valid JSON array of objects. No markdown, no code fences.
Format: [{"date":"${year}-${String(month).padStart(2, '0')}-01","topic":"...","platform":"IG","format":"Reel","caption":"...","hashtags":"#medspa #atlanta","category":"treatment"}]`;

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 8192,
                messages: [{ role: 'user', content: prompt }],
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[research/calendar] Anthropic API error:', response.status, errorText);
            return NextResponse.json({ error: 'AI service error' }, { status: 502 });
        }

        const data = await response.json();
        const text = data.content?.[0]?.text || '[]';

        let days: any[];
        try {
            const cleaned = text.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim();
            days = JSON.parse(cleaned);
            if (!Array.isArray(days)) days = [];
        } catch {
            console.error('[research/calendar] Failed to parse AI response:', text.slice(0, 200));
            return NextResponse.json({ error: 'Failed to parse AI calendar response' }, { status: 502 });
        }

        // Replace [BOOKING_LINK] placeholders with actual URLs
        for (const day of days) {
            if (day.caption && day.caption.includes('[BOOKING_LINK]')) {
                const url = findBookingUrlForCaption(day.caption);
                day.caption = day.caption.replace(/\[BOOKING_LINK\]/g, url);
            }
        }

        // Save to DB
        const userEmail = session.user.email;
        await sql`
            INSERT INTO research_calendars (month, year, calendar_data, created_by)
            VALUES (${month}, ${year}, ${JSON.stringify(days)}, ${userEmail})
        `.catch(e => console.error('[research/calendar] DB save error:', e));

        // Track usage
        const monthKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
        await sql`
            INSERT INTO api_usage_monthly (api_name, month_key, total_calls)
            VALUES ('research_calendar', ${monthKey}, 1)
            ON CONFLICT (api_name, month_key)
            DO UPDATE SET total_calls = api_usage_monthly.total_calls + 1
        `.catch(() => {});

        return NextResponse.json({ days, count: days.length });
    } catch (error: any) {
        console.error('[research/calendar] Error:', error);
        return NextResponse.json({ error: error.message || 'Calendar generation failed' }, { status: 500 });
    }
}
