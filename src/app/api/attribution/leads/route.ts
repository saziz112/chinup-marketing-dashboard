import { NextRequest, NextResponse } from 'next/server';
import { getPurchasingClientsFromDB } from '@/lib/integrations/mindbody-db';
import { attributeSource, getPlatformLabel, type AttributedPlatform } from '@/lib/attribution';
import { subDays, format } from 'date-fns';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

interface SourceBreakdown {
    platform: AttributedPlatform;
    label: string;
    count: number;
    percentage: number;
    newClients: number;
    returningClients: number;
}

interface LeadDetail {
    id: string;
    firstName: string;
    lastName: string;
    referralSource: string | null;
    attributedPlatform: AttributedPlatform;
    platformLabel: string;
    creationDate: string | null;
    isNew: boolean;
}

export async function GET(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const user = session.user as Record<string, unknown>;
        const isAdmin = user.isAdmin === true;

        const searchParams = request.nextUrl.searchParams;
        const periodParam = searchParams.get('period') || '30d';

        const days = periodParam === '7d' ? 7 : periodParam === '90d' ? 90 : 30;
        const endDate = new Date();
        const startDate = subDays(endDate, days);

        const formattedStart = format(startDate, "yyyy-MM-dd'T'00:00:00");
        const formattedEnd = format(endDate, "yyyy-MM-dd'T'23:59:59");

        const { clients } = await getPurchasingClientsFromDB(formattedStart, formattedEnd);

        const startMs = startDate.getTime();
        const endMs = endDate.getTime();

        // Group by attributed platform with new/returning breakdown
        const sourceMap = new Map<AttributedPlatform, { total: number; newCount: number }>();
        const leads: LeadDetail[] = [];
        let totalNew = 0;

        for (const client of clients) {
            const platform = attributeSource(client.ReferredBy);
            const isNew = client.CreationDate
                ? new Date(client.CreationDate).getTime() >= startMs && new Date(client.CreationDate).getTime() <= endMs
                : false;

            if (isNew) totalNew++;

            const entry = sourceMap.get(platform) || { total: 0, newCount: 0 };
            entry.total++;
            if (isNew) entry.newCount++;
            sourceMap.set(platform, entry);

            leads.push({
                id: client.Id,
                firstName: isAdmin ? client.FirstName : (client.FirstName?.[0] || '?') + '***',
                lastName: isAdmin ? (client.LastName || '') : ((client.LastName || '')[0] || '?') + '***',
                referralSource: client.ReferredBy || null,
                attributedPlatform: platform,
                platformLabel: getPlatformLabel(platform),
                creationDate: client.CreationDate || null,
                isNew,
            });
        }

        const totalClients = clients.length;
        const bySource: SourceBreakdown[] = Array.from(sourceMap.entries())
            .map(([platform, data]) => ({
                platform,
                label: getPlatformLabel(platform),
                count: data.total,
                percentage: totalClients > 0 ? Math.round((data.total / totalClients) * 1000) / 10 : 0,
                newClients: data.newCount,
                returningClients: data.total - data.newCount,
            }))
            .sort((a, b) => b.count - a.count);

        const topSource = bySource.length > 0 ? bySource[0].label : 'N/A';

        return NextResponse.json({
            totalClients,
            totalNew,
            totalReturning: totalClients - totalNew,
            topSource,
            bySource,
            leads: isAdmin ? leads : undefined,
            period: periodParam,
            startDate: formattedStart,
            endDate: formattedEnd,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Attribution leads error:', message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
