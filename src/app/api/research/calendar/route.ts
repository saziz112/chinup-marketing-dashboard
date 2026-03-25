/**
 * POST /api/research/calendar
 * Generate AI-powered monthly content calendar.
 * Uses Claude Haiku + saved trend topics + historical best-time data.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sql } from '@vercel/postgres';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

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

        // Get saved topics context
        const topicsContext = savedTopics?.length
            ? `Previously generated topic ideas to incorporate:\n${savedTopics.map((t: string) => `- ${t}`).join('\n')}`
            : '';

        // Try to get posting goals from existing content data
        const weeklyTarget = postsPerWeek || 12; // default ~3 per platform per week

        const prompt = `You are a social media strategist for Chin Up Aesthetics, a premium medical spa in Atlanta, GA.

BUSINESS CONTEXT:
- Treatments: Botox, dermal fillers, microneedling, hydrafacials, chemical peels, laser treatments, midface procedures, body contouring
- Platforms: Instagram (IG), Facebook (FB), YouTube (YT)
- Target audience: Women 25-55, metro Atlanta, professionals
- Tone: Professional, warm, empowering

TASK: Create a detailed content calendar for ${MONTH_NAMES[month - 1]} ${year} (${daysInMonth} days).

KEY DATES THIS MONTH:
${keyDates.map(d => `- ${d}`).join('\n')}

${topicsContext}

POSTING STRATEGY:
- Target ~${weeklyTarget} posts per week across all platforms
- Instagram: 3-4 per week (mix of Reels, Posts, Carousels)
- Facebook: 3 per week (Posts, shared Reels)
- YouTube: 1-2 per month (longer educational or before/after content)
- Not every day needs a post — rest days are OK
- Weekdays are better for educational content, weekends for lifestyle
- Best posting times: IG 9-11am + 7-9pm, FB 10am-2pm, YT anytime

CONTENT MIX TARGETS:
- 40% treatment-focused (showcase services, before/after, how it works)
- 25% promotional (seasonal offers, bundles, event-based deals)
- 20% educational (skincare tips, myth-busting, what to expect)
- 15% lifestyle (team spotlights, patient stories, behind-the-scenes)

REQUIREMENTS:
- Generate one entry per posting day (skip some days for rest)
- Each entry needs: date (YYYY-MM-DD format), topic, platform, format, caption (2-3 sentences + 3-5 hashtags), category
- Caption should be ready to post (not a placeholder)
- Include platform-appropriate hashtags
- Reference key dates naturally
- Vary formats throughout the month

Return ONLY a valid JSON array of objects. No markdown, no code fences.
Format: [{"date":"${year}-${String(month).padStart(2,'0')}-01","topic":"...","platform":"IG","format":"Reel","caption":"...","hashtags":"#medspa #atlanta","category":"treatment"}]`;

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
