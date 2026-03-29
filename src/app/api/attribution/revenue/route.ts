import { NextRequest, NextResponse } from 'next/server';
import { getPurchasingClientsFromDB } from '@/lib/integrations/mindbody-db';
import { attributeSource, getPlatformLabel, type AttributedPlatform } from '@/lib/attribution';
import { subDays, format } from 'date-fns';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

interface RevenueBySource {
    platform: AttributedPlatform;
    label: string;
    clientCount: number;
    revenue: number;
    revenuePerClient: number;
}

export async function GET(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const user = session.user as Record<string, unknown>;
        const isAdmin = user.isAdmin === true;

        if (!isAdmin) {
            return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
        }

        const searchParams = request.nextUrl.searchParams;
        const periodParam = searchParams.get('period') || '30d';

        const days = periodParam === '7d' ? 7 : periodParam === '90d' ? 90 : 30;
        const endDate = new Date();
        const startDate = subDays(endDate, days);

        const formattedStart = format(startDate, "yyyy-MM-dd'T'00:00:00");
        const formattedEnd = format(endDate, "yyyy-MM-dd'T'23:59:59");

        const { clients, sales } = await getPurchasingClientsFromDB(formattedStart, formattedEnd);

        // Map each client to their attributed platform
        const clientPlatformMap = new Map<string, AttributedPlatform>();
        for (const client of clients) {
            clientPlatformMap.set(client.Id, attributeSource(client.ReferredBy));
        }

        // Aggregate revenue by source for ALL purchasing clients
        const revenueMap = new Map<AttributedPlatform, { revenue: number; clientIds: Set<string> }>();

        for (const sale of sales) {
            const platform = clientPlatformMap.get(sale.ClientId) || 'unknown';
            const saleTotal = sale.PurchasedItems?.reduce(
                (sum, item) => sum + (item.TotalAmount || 0),
                0
            ) || 0;

            if (!revenueMap.has(platform)) {
                revenueMap.set(platform, { revenue: 0, clientIds: new Set() });
            }
            const entry = revenueMap.get(platform)!;
            entry.revenue += saleTotal;
            entry.clientIds.add(sale.ClientId);
        }

        // Build sorted result
        const bySource: RevenueBySource[] = Array.from(revenueMap.entries())
            .map(([platform, data]) => {
                const clientCount = data.clientIds.size;
                const revenue = Math.round(data.revenue * 100) / 100;
                return {
                    platform,
                    label: getPlatformLabel(platform),
                    clientCount,
                    revenue,
                    revenuePerClient: clientCount > 0 ? Math.round((revenue / clientCount) * 100) / 100 : 0,
                };
            })
            .sort((a, b) => b.revenue - a.revenue);

        const totalRevenue = bySource.reduce((sum, s) => sum + s.revenue, 0);
        const totalClients = clients.length;
        const avgRevenuePerClient = totalClients > 0 ? Math.round((totalRevenue / totalClients) * 100) / 100 : 0;

        return NextResponse.json({
            totalRevenue: Math.round(totalRevenue * 100) / 100,
            formattedRevenue: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(totalRevenue),
            totalClients,
            avgRevenuePerClient,
            formattedAvgRevenue: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(avgRevenuePerClient),
            bySource,
            period: periodParam,
            startDate: formattedStart,
            endDate: formattedEnd,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Attribution revenue error:', message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
