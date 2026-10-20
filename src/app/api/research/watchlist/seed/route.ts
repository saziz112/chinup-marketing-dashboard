/**
 * POST /api/research/watchlist/seed
 * Load the verified starter list. Existing accounts (including ones someone
 * removed and re-added) are left alone. No scraping happens here.
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sql } from '@/lib/db/sql';
import { ensureContentResearchTables } from '@/lib/db';
import { SEED_WATCHLIST } from '@/lib/content-research/seed-watchlist';
import { dedupeAccounts, parseAccountInput } from '@/lib/content-research/watchlist';

export async function POST() {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    try {
        await ensureContentResearchTables();
        let added = 0;
        for (const a of dedupeAccounts(SEED_WATCHLIST)) {
            const p = parseAccountInput(a.platform, a.handle);
            if (!p) continue;
            const { rows } = await sql`
                INSERT INTO research_watchlist (platform, handle, display_name, category, added_by)
                VALUES (${p.platform}, ${p.handle}, ${a.displayName ?? null}, ${a.category ?? 'other'}, ${session.user.email})
                ON CONFLICT (platform, handle) DO NOTHING
                RETURNING id
            `;
            added += rows.length;
        }
        return NextResponse.json({ added, total: SEED_WATCHLIST.length });
    } catch (error) {
        console.error('[research/watchlist/seed] failed:', error);
        return NextResponse.json({ error: 'Failed to load starter list' }, { status: 500 });
    }
}
