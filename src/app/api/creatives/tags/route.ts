/**
 * /api/creatives/tags
 * GET: Fetch all unique tags with usage counts
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sql } from '@/lib/db/sql';

export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const result = await sql`
            SELECT tag, COUNT(*)::int as count
            FROM creative_image_tags
            GROUP BY tag
            ORDER BY count DESC
        `;

        const tags = result.rows.map(row => ({
            tag: row.tag,
            count: row.count,
        }));

        return NextResponse.json({ tags });
    } catch (error: unknown) {
        console.error('Creatives tags error:', error);
        return NextResponse.json({ tags: [] });
    }
}
