/**
 * GET /api/research/market?month=4&year=2026
 * Internal data aggregation for Market Intel tab.
 * Pulls from: social_posts, search_console_daily, mb_appointments_history, ghl_contacts_map
 * + Claude AI for promotion ideas based on collected data.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sql } from '@vercel/postgres';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

export async function GET(req: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        // Fetch all internal data sources in parallel
        const [topPostsRes, searchRes, treatmentsRes, sourcesRes] = await Promise.allSettled([
            // Top posts by engagement
            sql`
                SELECT
                    COALESCE(SUBSTRING(caption FROM 1 FOR 60), post_type || ' post') AS title,
                    platform,
                    engagement_rate,
                    views,
                    likes,
                    comments
                FROM social_posts
                WHERE posted_at > NOW() - INTERVAL '90 days'
                AND engagement_rate IS NOT NULL
                ORDER BY engagement_rate DESC NULLS LAST
                LIMIT 10
            `,
            // Search Console top queries
            sql`
                SELECT
                    query,
                    SUM(clicks)::int AS clicks,
                    SUM(impressions)::int AS impressions,
                    ROUND(AVG(position)::numeric, 1) AS position
                FROM search_console_daily
                WHERE metric_date > CURRENT_DATE - 60
                AND query IS NOT NULL
                GROUP BY query
                ORDER BY SUM(clicks) DESC
                LIMIT 15
            `,
            // Most-booked treatments (from MindBody appointments)
            sql`
                SELECT
                    session_type_name AS name,
                    COUNT(*)::int AS count
                FROM mb_appointments_history
                WHERE start_date > NOW() - INTERVAL '90 days'
                AND status IN ('Completed', 'Confirmed')
                AND session_type_name IS NOT NULL
                GROUP BY session_type_name
                ORDER BY count DESC
                LIMIT 10
            `,
            // Lead sources from GHL contacts
            sql`
                SELECT
                    COALESCE(
                        (tags->0)::text,
                        'Unknown'
                    ) AS source,
                    COUNT(*)::int AS count
                FROM ghl_contacts_map
                WHERE created_at > NOW() - INTERVAL '90 days'
                GROUP BY source
                ORDER BY count DESC
                LIMIT 10
            `,
        ]);

        const topPosts = topPostsRes.status === 'fulfilled'
            ? topPostsRes.value.rows.map(p => ({
                title: p.title,
                platform: p.platform,
                engagementRate: Number(p.engagement_rate) || 0,
                views: Number(p.views) || 0,
            }))
            : [];

        const searchQueries = searchRes.status === 'fulfilled'
            ? searchRes.value.rows.map(q => ({
                query: q.query,
                clicks: Number(q.clicks) || 0,
                impressions: Number(q.impressions) || 0,
                position: Number(q.position) || 0,
            }))
            : [];

        const topTreatments = treatmentsRes.status === 'fulfilled'
            ? treatmentsRes.value.rows.map(t => ({
                name: t.name,
                count: Number(t.count) || 0,
            }))
            : [];

        const topSources = sourcesRes.status === 'fulfilled'
            ? sourcesRes.value.rows.map(s => ({
                source: String(s.source).replace(/"/g, ''),
                count: Number(s.count) || 0,
                trend: 'flat' as const,
            }))
            : [];

        // Generate promotion ideas using Claude (if API key available)
        let promotionIdeas: any[] = [];
        if (ANTHROPIC_API_KEY) {
            promotionIdeas = await generatePromotionIdeas(topTreatments, searchQueries, topPosts);
        }

        return NextResponse.json({
            topPosts,
            searchQueries,
            topTreatments,
            topSources,
            bestTimes: [], // Could derive from social_posts posted_at hours
            promotionIdeas,
        });
    } catch (error: any) {
        console.error('[research/market] Error:', error);
        return NextResponse.json({ error: error.message || 'Market data fetch failed' }, { status: 500 });
    }
}

async function generatePromotionIdeas(
    treatments: Array<{ name: string; count: number }>,
    queries: Array<{ query: string; clicks: number }>,
    posts: Array<{ title: string; engagementRate: number }>,
): Promise<any[]> {
    const treatmentList = treatments.slice(0, 5).map(t => `${t.name} (${t.count} bookings)`).join(', ');
    const queryList = queries.slice(0, 5).map(q => `"${q.query}" (${q.clicks} clicks)`).join(', ');
    const postList = posts.slice(0, 3).map(p => `"${p.title}" (${(p.engagementRate * 100).toFixed(1)}% engagement)`).join(', ');

    const now = new Date();
    const monthName = now.toLocaleString('en-US', { month: 'long' });

    const prompt = `You are a marketing strategist for Chin Up Aesthetics, a premium med spa in Atlanta, GA.

Based on this real business data, suggest 4 promotional ideas:

TOP TREATMENTS (last 90 days): ${treatmentList || 'No data'}
TOP SEARCH QUERIES: ${queryList || 'No data'}
TOP-PERFORMING CONTENT: ${postList || 'No data'}
CURRENT MONTH: ${monthName} ${now.getFullYear()}

For each promotion, provide:
- name: Catchy promotion name
- offer: Specific offer details (discount, bundle, add-on)
- audience: Target audience for this promotion
- angle: Creative angle for marketing this promotion

Make promotions specific to aesthetics treatments and seasonally relevant.

Return ONLY valid JSON array: [{"name":"...","offer":"...","audience":"...","angle":"..."}]
No markdown, no code fences.`;

    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': ANTHROPIC_API_KEY!,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 1024,
                messages: [{ role: 'user', content: prompt }],
            }),
        });

        if (!response.ok) return [];

        const data = await response.json();
        const text = data.content?.[0]?.text || '[]';
        const cleaned = text.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim();
        const parsed = JSON.parse(cleaned);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}
