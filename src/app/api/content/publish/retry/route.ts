import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { retryFailedPlatforms } from '@/lib/content-publisher';

export const maxDuration = 60;

export async function POST(req: Request) {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { id } = await req.json();
        if (!id) {
            return NextResponse.json({ error: 'Post ID is required' }, { status: 400 });
        }

        const updated = await retryFailedPlatforms(id);
        if (!updated) {
            return NextResponse.json(
                { error: 'Post not found, or not in FAILED/PARTIAL state' },
                { status: 404 },
            );
        }

        return NextResponse.json({
            post: updated,
            status: updated.status,
            results: updated.publishResults || [],
        });
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Retry failed';
        console.error('[Publish Retry] error:', error);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
