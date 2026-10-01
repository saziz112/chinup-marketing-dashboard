/**
 * For the bonus dashboard's call list: phone hashes texted by any campaign
 * here in the last `days` (default 30), so it does not call them on top.
 * See lib/outreach-list.ts.
 */

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db/sql';
import { syncAuthorized } from '@/lib/outreach-list';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    if (!syncAuthorized(req)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const days = Math.min(90, Math.max(1, Number(req.nextUrl.searchParams.get('days')) || 30));
    try {
        const result = await sql`
            SELECT DISTINCT phone_hash FROM campaign_contacts
            WHERE sent_at > NOW() - make_interval(days => ${days}::int)
              AND status = 'sent'
              AND phone_hash IS NOT NULL
        `;
        return NextResponse.json({ days, hashes: result.rows.map(r => r.phone_hash) });
    } catch (e) {
        console.error('[outreach-sync/recent-texts] error:', e);
        return NextResponse.json({ error: 'Could not read campaign history' }, { status: 500 });
    }
}
