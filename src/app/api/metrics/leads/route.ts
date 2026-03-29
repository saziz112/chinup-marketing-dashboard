import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getNewClientsCountFromDB } from '@/lib/integrations/mindbody-db';
import { subDays, format } from 'date-fns';

export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const endDate = new Date();
        const startDate = subDays(endDate, 30);

        const formattedStart = format(startDate, "yyyy-MM-dd'T'00:00:00");
        const formattedEnd = format(endDate, "yyyy-MM-dd'T'23:59:59");

        const count = await getNewClientsCountFromDB(formattedStart, formattedEnd);

        return NextResponse.json({
            count,
            period: '30d',
            startDate: formattedStart,
            endDate: formattedEnd
        });
    } catch (error: any) {
        console.error('Lead metrics error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
