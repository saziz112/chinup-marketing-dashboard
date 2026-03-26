/**
 * GET /api/research/content-analysis
 * Auto-categorizes past posts and shows performance by content type.
 * Answers the question: "Should we post educational or trending content?"
 * with actual data: avg views, engagement, comments per category.
 *
 * Categories:
 *   - Educational: how-to, tips, myth-busting, treatment explainers
 *   - Before/After: transformation content, results
 *   - Trending/Viral: short hooks, trending sounds, no treatment specifics
 *   - Promotional: offers, deals, seasonal specials
 *   - Lifestyle: team, behind-the-scenes, patient stories
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sql } from '@vercel/postgres';

type ContentCategory = 'educational' | 'before_after' | 'promotional' | 'trending' | 'lifestyle';

// Keyword-based categorization rules (order matters — first match wins)
const CATEGORY_RULES: { category: ContentCategory; patterns: RegExp[] }[] = [
    {
        category: 'before_after',
        patterns: [
            /before\s*(and|&|\/)\s*after/i,
            /transformation/i,
            /results?\s*(are|speak|after)/i,
            /\bB&A\b/i,
            /glow\s*up/i,
            /check\s*out\s*(these|this)\s*results?/i,
        ],
    },
    {
        category: 'promotional',
        patterns: [
            /\b(deal|offer|discount|promo|sale|special|savings?)\b/i,
            /\b\d+%\s*off\b/i,
            /\$\d+/i,
            /limited\s*time/i,
            /book\s*(now|today)/i,
            /flash\s*sale/i,
            /gift\s*card/i,
            /free\s*(consult|consultation)/i,
        ],
    },
    {
        category: 'educational',
        patterns: [
            /\b(how\s+to|what\s+is|did\s+you\s+know|myth|fact|tip|guide|learn|explained|everything\s+you)\b/i,
            /\b(difference\s+between|vs\.?|versus)\b/i,
            /\b(what\s+to\s+expect|recovery|downtime|aftercare|prep)\b/i,
            /\b(science\s+behind|works\s+by|faq)\b/i,
        ],
    },
    {
        category: 'lifestyle',
        patterns: [
            /\b(team|staff|behind\s+the\s+scenes|day\s+in\s+the\s+life|meet)\b/i,
            /\b(office|clinic)\s*(tour|vibes|aesthetic)\b/i,
            /\b(self[\s-]?care|wellness\s+journey|patient\s+story|testimonial)\b/i,
            /\b(happy\s+(monday|friday|weekend))\b/i,
        ],
    },
    // Trending is the fallback if nothing else matches
];

function categorizePost(caption: string): ContentCategory {
    if (!caption) return 'trending';
    for (const rule of CATEGORY_RULES) {
        for (const pattern of rule.patterns) {
            if (pattern.test(caption)) {
                return rule.category;
            }
        }
    }
    return 'trending'; // Default: short/generic content = trending/viral
}

interface CategoryStats {
    category: ContentCategory;
    label: string;
    postCount: number;
    avgViews: number;
    avgLikes: number;
    avgComments: number;
    avgEngagement: number;
    bestPost: { caption: string; views: number; engagement: number; permalink: string } | null;
}

const CATEGORY_LABELS: Record<ContentCategory, string> = {
    educational: 'Educational',
    before_after: 'Before / After',
    promotional: 'Promotional',
    trending: 'Trending / Viral',
    lifestyle: 'Lifestyle',
};

export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const result = await sql`
            SELECT
                caption, platform, post_type, permalink,
                likes, comments, shares, saves, views,
                engagement_rate, posted_at
            FROM social_posts
            WHERE posted_at > NOW() - INTERVAL '90 days'
                AND caption IS NOT NULL
            ORDER BY posted_at DESC
        `;

        const posts = result.rows;

        if (posts.length === 0) {
            return NextResponse.json({
                categories: [],
                totalPosts: 0,
                message: 'No posts found in the last 90 days',
            });
        }

        // Categorize each post
        const categorized = posts.map(p => ({
            caption: p.caption as string,
            platform: p.platform as string,
            post_type: p.post_type as string,
            permalink: p.permalink as string,
            likes: Number(p.likes) || 0,
            comments: Number(p.comments) || 0,
            shares: Number(p.shares) || 0,
            saves: Number(p.saves) || 0,
            views: Number(p.views) || 0,
            engagement_rate: Number(p.engagement_rate) || 0,
            posted_at: p.posted_at as string,
            content_category: categorizePost(p.caption || ''),
        }));

        type CategorizedPost = typeof categorized[number];

        // Aggregate stats per category
        const categoryMap = new Map<ContentCategory, CategorizedPost[]>();
        for (const post of categorized) {
            const arr = categoryMap.get(post.content_category) || [];
            arr.push(post);
            categoryMap.set(post.content_category, arr);
        }

        const categories: CategoryStats[] = [];
        for (const [cat, catPosts] of categoryMap.entries()) {
            const totalViews = catPosts.reduce((s, p) => s + (Number(p.views) || 0), 0);
            const totalLikes = catPosts.reduce((s, p) => s + (Number(p.likes) || 0), 0);
            const totalComments = catPosts.reduce((s, p) => s + (Number(p.comments) || 0), 0);
            const totalEngagement = catPosts.reduce((s, p) => s + (Number(p.engagement_rate) || 0), 0);
            const count = catPosts.length;

            // Find best post by engagement
            const sorted = [...catPosts].sort((a, b) => (Number(b.engagement_rate) || 0) - (Number(a.engagement_rate) || 0));
            const best = sorted[0];

            categories.push({
                category: cat,
                label: CATEGORY_LABELS[cat],
                postCount: count,
                avgViews: Math.round(totalViews / count),
                avgLikes: Math.round(totalLikes / count),
                avgComments: Math.round(totalComments / count),
                avgEngagement: Number((totalEngagement / count).toFixed(4)),
                bestPost: best ? {
                    caption: (best.caption || '').slice(0, 80),
                    views: Number(best.views) || 0,
                    engagement: Number(best.engagement_rate) || 0,
                    permalink: best.permalink || '',
                } : null,
            });
        }

        // Sort by avg engagement descending
        categories.sort((a, b) => b.avgEngagement - a.avgEngagement);

        // Overall stats
        const overallAvgEngagement = posts.reduce((s, p) => s + (Number(p.engagement_rate) || 0), 0) / posts.length;
        const overallAvgViews = posts.reduce((s, p) => s + (Number(p.views) || 0), 0) / posts.length;

        return NextResponse.json({
            categories,
            totalPosts: posts.length,
            overallAvgEngagement: Number(overallAvgEngagement.toFixed(4)),
            overallAvgViews: Math.round(overallAvgViews),
            period: '90 days',
        });
    } catch (error: any) {
        console.error('[research/content-analysis] Error:', error);
        return NextResponse.json({ error: error.message || 'Content analysis failed' }, { status: 500 });
    }
}
