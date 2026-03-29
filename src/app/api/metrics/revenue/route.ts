import { NextResponse } from 'next/server';
import { getRevenueFromDB } from '@/lib/integrations/mindbody-db';
import { subDays, format } from 'date-fns';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function GET(req: Request) {
    try {
        const session = await getServerSession(authOptions);
        const user = session?.user as Record<string, unknown> | undefined;

        if (!user || user.isAdmin !== true) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Read optional period from query params (default 30d)
        const { searchParams } = new URL(req.url);
        const period = searchParams.get('period') || '30d';

        const endDate = new Date();
        let startDate: Date;
        if (period === '7d') {
            startDate = subDays(endDate, 6); // 7 days inclusive
        } else if (period === '90d') {
            startDate = subDays(endDate, 89); // 90 days inclusive
        } else {
            startDate = subDays(endDate, 29); // 30 days inclusive (e.g., Feb 3 → Mar 4)
        }

        const formattedStart = format(startDate, "yyyy-MM-dd'T'00:00:00");
        const formattedEnd = format(endDate, "yyyy-MM-dd'T'23:59:59");

        const { totalRevenue, saleCount } = await getRevenueFromDB(formattedStart, formattedEnd);

        return NextResponse.json({
            amount: totalRevenue,
            formattedAmount: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(totalRevenue),
            count: saleCount,
            period,
            dateRange: {
                start: format(startDate, 'MMM d, yyyy'),
                end: format(endDate, 'MMM d, yyyy'),
            }
        });
    } catch (error: any) {
        console.error('Revenue metrics error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
