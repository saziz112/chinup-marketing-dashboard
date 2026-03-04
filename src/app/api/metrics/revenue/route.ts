import { NextResponse } from 'next/server';
import { getSales } from '@/lib/integrations/mindbody';
import { subDays, format } from 'date-fns';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function GET() {
    try {
        const session = await getServerSession(authOptions);
        const user = session?.user as Record<string, unknown> | undefined;

        if (!user || user.isAdmin !== true) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const endDate = new Date();
        const startDate = subDays(endDate, 30);

        const formattedStart = format(startDate, "yyyy-MM-dd'T'00:00:00");
        const formattedEnd = format(endDate, "yyyy-MM-dd'T'23:59:59");

        const sales = await getSales(formattedStart, formattedEnd);

        const totalRevenue = sales.reduce((sum, sale) => {
            const saleTotal = sale.PurchasedItems?.reduce((itemSum, item) => itemSum + (item.TotalAmount || 0), 0) || 0;
            return sum + saleTotal;
        }, 0);

        return NextResponse.json({
            amount: totalRevenue,
            formattedAmount: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(totalRevenue),
            count: sales.length,
            period: '30d'
        });
    } catch (error: any) {
        console.error('Revenue metrics error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
