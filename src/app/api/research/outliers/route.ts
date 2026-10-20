/**
 * GET /api/research/outliers?platform=all&days=90&limit=50
 * Videos ranked by outlier score (views ÷ that account's median views).
 * Reads stored scrapes only; never calls Apify.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sql } from '@/lib/db/sql';
import { ensureContentResearchTables } from '@/lib/db';
import { rankOutliers } from '@/lib/content-research/outlier';
import { PLATFORMS, type Platform } from '@/lib/content-research/watchlist';

export async function GET(req: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const sp = req.nextUrl.searchParams;
    const platform = sp.get('platform') as Platform | null;
    const days = Math.min(Math.max(Number(sp.get('days')) || 90, 7), 365);
    const limit = Math.min(Math.max(Number(sp.get('limit')) || 50, 1), 200);

    try {
        await ensureContentResearchTables();
        // Median comes from every stored video for the account; the date filter
        // only limits which videos can show up as outliers.
        const { rows } = await sql`
            SELECT v.id, v.account_id, v.platform, v.url, v.caption, v.views, v.likes, v.comments, v.shares,
                   v.duration_sec, v.posted_at, v.thumbnail_url, (v.transcript IS NOT NULL) AS has_transcript,
                   w.handle, w.display_name, w.category,
                   (a.video_id IS NOT NULL) AS analyzed
            FROM research_videos v
            JOIN research_watchlist w ON w.id = v.account_id AND w.active
            LEFT JOIN research_video_analyses a ON a.video_id = v.id
        `;
        const byId = new Map(rows.map(r => [r.id as number, r]));
        const cutoff = Date.now() - days * 86_400_000;
        const ranked = rankOutliers(rows.map(r => ({ id: r.id, accountId: r.account_id, views: r.views === null ? null : Number(r.views) })))
            .filter(o => {
                const r = byId.get(o.id)!;
                if (PLATFORMS.includes(platform as Platform) && r.platform !== platform) return false;
                return !r.posted_at || new Date(r.posted_at).getTime() >= cutoff;
            })
            .slice(0, limit)
            .map(o => {
                const r = byId.get(o.id)!;
                return {
                    ...o,
                    platform: r.platform, url: r.url, caption: r.caption, likes: num(r.likes), comments: num(r.comments),
                    shares: num(r.shares), durationSec: r.duration_sec, postedAt: r.posted_at, thumbnailUrl: r.thumbnail_url,
                    handle: r.handle, displayName: r.display_name, category: r.category,
                    hasTranscript: r.has_transcript, analyzed: r.analyzed,
                };
            });
        return NextResponse.json({ outliers: ranked, totalVideos: rows.length });
    } catch (error) {
        console.error('[research/outliers] failed:', error);
        return NextResponse.json({ error: 'Failed to load outliers' }, { status: 500 });
    }
}

function num(v: unknown): number | null {
    return v === null || v === undefined ? null : Number(v);
}
