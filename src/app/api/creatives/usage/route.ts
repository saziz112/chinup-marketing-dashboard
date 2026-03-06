/**
 * /api/creatives/usage
 * GET: Admin-only endpoint returning monthly generation usage and cost breakdown
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sql } from '@vercel/postgres';

const PRICING: Record<string, number> = {
    '1024': 0.04,
    '2048': 0.06,
    '4096': 0.09,
};

interface ResolutionBucket {
    count: number;
    cost: number;
}

interface MonthSummary {
    total: number;
    cost: number;
    byResolution: Record<string, ResolutionBucket>;
}

function emptyMonth(): MonthSummary {
    return {
        total: 0,
        cost: 0,
        byResolution: {
            '1024': { count: 0, cost: 0 },
            '2048': { count: 0, cost: 0 },
            '4096': { count: 0, cost: 0 },
        },
    };
}

export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session?.user || !(session.user as any).isAdmin) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const result = await sql`
            SELECT
                to_char(created_at, 'YYYY-MM') as month,
                resolution::text as resolution,
                COUNT(*)::int as count
            FROM creative_images
            WHERE status = 'success'
              AND created_at >= date_trunc('month', now()) - interval '1 month'
            GROUP BY month, resolution
            ORDER BY month DESC, resolution
        `;

        const now = new Date();
        const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const previousMonthKey = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;

        const currentMonth = emptyMonth();
        const previousMonth = emptyMonth();

        for (const row of result.rows) {
            const target = row.month === currentMonthKey ? currentMonth
                         : row.month === previousMonthKey ? previousMonth
                         : null;
            if (!target) continue;

            const res = String(row.resolution);
            const count = Number(row.count);
            const unitCost = PRICING[res] ?? 0.04;
            const cost = parseFloat((count * unitCost).toFixed(2));

            target.total += count;
            target.cost = parseFloat((target.cost + cost).toFixed(2));

            if (target.byResolution[res]) {
                target.byResolution[res].count += count;
                target.byResolution[res].cost = parseFloat(
                    (target.byResolution[res].cost + cost).toFixed(2),
                );
            } else {
                target.byResolution[res] = { count, cost };
            }
        }

        return NextResponse.json({ currentMonth, previousMonth });
    } catch (error: unknown) {
        console.error('Creatives usage error:', error);
        return NextResponse.json({
            currentMonth: emptyMonth(),
            previousMonth: emptyMonth(),
        });
    }
}
