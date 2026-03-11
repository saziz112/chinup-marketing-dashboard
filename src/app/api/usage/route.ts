import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUsageStats } from '@/lib/api-usage-tracker';

export async function GET() {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const user = session.user as Record<string, unknown>;
        if (user.isAdmin !== true) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const stats = await getUsageStats();
        return NextResponse.json(stats);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Usage stats error:', message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
