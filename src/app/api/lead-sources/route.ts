/**
 * /api/lead-sources
 * GET: Lead-source funnel — leads / new leads / purchased / revenue by channel.
 *
 * Query params:
 *   - location:      'decatur' | 'kennesaw' | 'smyrna' (optional, default all)
 *   - month:         'YYYY-MM' — leads submitted in that calendar month.
 *                    Takes precedence over minAge/maxAge, and is the form to
 *                    prefer for any figure someone will quote: the age bounds
 *                    are measured from now(), so they slide between requests.
 *   - minAge:        lower bound on lead age in days (default 30)
 *   - maxAge:        upper bound on lead age in days (default 90)
 *   - maturation:    days each lead gets to convert (default 30)
 *
 * See docs/superpowers/specs/2026-08-10-lead-source-tracking-design.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getLeadSourceReport } from '@/lib/lead-sources';

const VALID_LOCATIONS = new Set(['decatur', 'kennesaw', 'smyrna']);

export async function GET(req: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user as Record<string, unknown>;
    const isAdmin = user.isAdmin === true;

    const p = req.nextUrl.searchParams;
    const locationParam = p.get('location');
    const location = locationParam && VALID_LOCATIONS.has(locationParam) ? locationParam : null;

    const num = (key: string, fallback: number) => {
        const v = Number(p.get(key));
        return Number.isFinite(v) && v > 0 ? v : fallback;
    };

    const minAgeDays = num('minAge', 30);
    const maxAgeDays = num('maxAge', 90);
    if (maxAgeDays <= minAgeDays) {
        return NextResponse.json({ error: 'maxAge must exceed minAge' }, { status: 400 });
    }

    // month=YYYY-MM -> [first of month, first of next month)
    let from: string | null = null;
    let to: string | null = null;
    const month = p.get('month');
    if (month) {
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
            return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 });
        }
        const [y, m] = month.split('-').map(Number);
        const pad = (n: number) => String(n).padStart(2, '0');
        from = `${y}-${pad(m)}-01`;
        to = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
    }

    try {
        const data = await getLeadSourceReport({
            minAgeDays,
            maxAgeDays,
            from,
            to,
            maturationDays: num('maturation', 30),
            location,
        });

        // Non-admins see volumes and rates but not dollar values, matching
        // the role split used by /api/attribution/ghl-pipeline.
        if (!isAdmin) {
            return NextResponse.json({
                ...data,
                rows: data.rows.map(
                    ({ revenue: _r, revenueToDate: _rtd, revPerLead: _rp, ...rest }) => rest,
                ),
                totals: { ...data.totals, revenue: undefined, revenueToDate: undefined },
            });
        }

        return NextResponse.json(data);
    } catch (err) {
        console.error('[lead-sources] query failed', err);
        return NextResponse.json({ error: 'Query failed' }, { status: 500 });
    }
}
