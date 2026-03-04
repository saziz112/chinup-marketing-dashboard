import { NextResponse } from 'next/server';
import { getSearchConsoleData } from '@/lib/integrations/search-console';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const periodParam = searchParams.get('period') || '30';
        const periodDays = parseInt(periodParam, 10);

        // Fetch GSC Data (mocked currently)
        const gscData = await getSearchConsoleData(periodDays);

        return NextResponse.json(gscData);
    } catch (error) {
        console.error('Error fetching Search Console data:', error);
        return NextResponse.json({ error: 'Failed to fetch search console data' }, { status: 500 });
    }
}
