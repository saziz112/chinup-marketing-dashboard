/**
 * For the bonus dashboard's Daily Checks: when each campaign last actually sent.
 * A run row is written before sending, so runs that sent nothing are ignored.
 */

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db/sql';
import { syncAuthorized } from '@/lib/outreach-list';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    if (!syncAuthorized(req)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    try {
        const rows = await sql`
            SELECT segment, MAX(run_at) AS last_sent_at
            FROM campaign_runs
            WHERE total_sent > 0
            GROUP BY segment
        `;
        return NextResponse.json({
            segments: rows.rows.map(r => ({ segment: String(r.segment), lastSentAt: new Date(r.last_sent_at).toISOString() })),
        });
    } catch (e) {
        console.error('[outreach-sync/campaign-status] error:', e);
        return NextResponse.json({ error: 'Could not read campaign history' }, { status: 500 });
    }
}
