/**
 * /api/attribution/ghl-reactivation/history
 * GET: Returns campaign history (last runs per segment + recent activity)
 * Admin-only
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sql } from '@vercel/postgres';

export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const user = session.user as Record<string, unknown>;
    if (user.isAdmin !== true) {
        return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    try {
        // Last run per segment
        const lastRuns = await sql`
            SELECT DISTINCT ON (segment)
                segment, segment_label, channel, location_key,
                total_targeted, total_sent, total_failed, total_skipped,
                run_by, run_at
            FROM campaign_runs
            ORDER BY segment, run_at DESC
        `;

        // Recent runs (last 30 days, most recent 20)
        const recentRuns = await sql`
            SELECT
                run_id, segment, segment_label, channel, location_key,
                total_targeted, total_sent, total_failed, total_skipped,
                run_by, run_at
            FROM campaign_runs
            WHERE run_at > NOW() - INTERVAL '30 days'
            ORDER BY run_at DESC
            LIMIT 20
        `;

        // Total contacts contacted in last 30 days
        const cooldownCount = await sql`
            SELECT COUNT(DISTINCT phone_hash) as count
            FROM campaign_contacts
            WHERE sent_at > NOW() - INTERVAL '30 days'
            AND status = 'sent'
            AND phone_hash IS NOT NULL
        `;

        return NextResponse.json({
            lastRunPerSegment: lastRuns.rows,
            recentRuns: recentRuns.rows,
            cooldownContactCount: parseInt(cooldownCount.rows[0]?.count || '0'),
        });
    } catch (error) {
        // Tables may not exist yet
        console.warn('[campaign-history] Error:', error);
        return NextResponse.json({
            lastRunPerSegment: [],
            recentRuns: [],
            cooldownContactCount: 0,
        });
    }
}
