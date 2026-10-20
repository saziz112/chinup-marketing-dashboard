/**
 * GET    /api/research/watchlist          accounts + which integrations are configured
 * POST   /api/research/watchlist          { platform, handle | profile URL, category? }
 * DELETE /api/research/watchlist?id=12    remove an account (and its scraped videos)
 *
 * Reading the watchlist never triggers a scrape.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sql } from '@/lib/db/sql';
import { ensureContentResearchTables } from '@/lib/db';
import { parseAccountInput, PLATFORMS, type Platform, type AccountCategory } from '@/lib/content-research/watchlist';
import { researchConfig } from '@/lib/content-research/scrape';

const CATEGORIES: AccountCategory[] = ['injector_creator', 'medspa_brand', 'atlanta_competitor', 'other'];

export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    try {
        await ensureContentResearchTables();
        const { rows } = await sql`
            SELECT id, platform, handle, display_name, category, active, median_views, video_count, last_scraped_at, last_error
            FROM research_watchlist ORDER BY platform, category, handle
        `;
        const { rows: runs } = await sql`
            SELECT platform, account_count, item_count, est_cost_usd, status, error, started_at, finished_at
            FROM research_scrape_runs ORDER BY started_at DESC LIMIT 5
        `;
        return NextResponse.json({ configured: researchConfig(), accounts: rows, recentRuns: runs });
    } catch (error) {
        console.error('[research/watchlist] GET failed:', error);
        return NextResponse.json({ error: 'Failed to load watchlist' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const platform = body.platform as Platform;
    if (!PLATFORMS.includes(platform)) return NextResponse.json({ error: 'Pick Instagram, TikTok or YouTube' }, { status: 400 });
    const parsed = parseAccountInput(platform, String(body.handle ?? ''));
    if (!parsed) return NextResponse.json({ error: 'Enter a handle like @name or a profile link' }, { status: 400 });
    const category: AccountCategory = CATEGORIES.includes(body.category) ? body.category : 'other';

    try {
        await ensureContentResearchTables();
        const { rows } = await sql`
            INSERT INTO research_watchlist (platform, handle, display_name, category, added_by)
            VALUES (${parsed.platform}, ${parsed.handle}, ${body.displayName || null}, ${category}, ${session.user.email})
            ON CONFLICT (platform, handle) DO UPDATE SET active = TRUE
            RETURNING id, platform, handle, display_name, category, active, median_views, video_count, last_scraped_at, last_error
        `;
        return NextResponse.json({ account: rows[0] });
    } catch (error) {
        console.error('[research/watchlist] POST failed:', error);
        return NextResponse.json({ error: 'Failed to add account' }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const id = Number(req.nextUrl.searchParams.get('id'));
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    try {
        await ensureContentResearchTables();
        await sql`DELETE FROM research_watchlist WHERE id = ${id}`;
        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error('[research/watchlist] DELETE failed:', error);
        return NextResponse.json({ error: 'Failed to remove account' }, { status: 500 });
    }
}
