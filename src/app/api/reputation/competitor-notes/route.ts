/**
 * /api/reputation/competitor-notes
 * GET: Fetch saved competitor strengths/weaknesses overrides
 * POST: Save competitor strengths/weaknesses (admin only)
 *
 * Query params (GET):
 *   - location: 'all' | 'atlanta' | 'decatur' | 'kennesaw'
 *
 * Body (POST):
 *   - location: string
 *   - competitorId: string
 *   - strengths: string[]
 *   - weaknesses: string[]
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sql } from '@/lib/db/sql';

async function ensureTable() {
    await sql`
        CREATE TABLE IF NOT EXISTS competitor_notes (
            id SERIAL PRIMARY KEY,
            location_id VARCHAR(20) NOT NULL,
            competitor_id VARCHAR(100) NOT NULL,
            strengths TEXT DEFAULT '[]',
            weaknesses TEXT DEFAULT '[]',
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_by VARCHAR(255),
            UNIQUE(location_id, competitor_id)
        )
    `;
}

export async function GET(req: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const location = req.nextUrl.searchParams.get('location') || 'all';

    try {
        await ensureTable();
        const result = await sql`
            SELECT competitor_id, strengths, weaknesses, updated_at, updated_by
            FROM competitor_notes
            WHERE location_id = ${location}
        `;

        const notes: Record<string, { strengths: string[]; weaknesses: string[] }> = {};
        for (const row of result.rows) {
            notes[row.competitor_id] = {
                strengths: JSON.parse(row.strengths || '[]'),
                weaknesses: JSON.parse(row.weaknesses || '[]'),
            };
        }

        return NextResponse.json({ notes });
    } catch (error) {
        console.error('[competitor-notes] Error:', error);
        return NextResponse.json({ error: 'Failed to fetch notes' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user as Record<string, unknown>;
    if (user.isAdmin !== true) {
        return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    try {
        const body = await req.json();
        const { location, competitorId, strengths, weaknesses } = body;

        if (!location || !competitorId) {
            return NextResponse.json({ error: 'Missing location or competitorId' }, { status: 400 });
        }

        await ensureTable();
        await sql`
            INSERT INTO competitor_notes (location_id, competitor_id, strengths, weaknesses, updated_by, updated_at)
            VALUES (${location}, ${competitorId}, ${JSON.stringify(strengths || [])}, ${JSON.stringify(weaknesses || [])}, ${session.user.email}, NOW())
            ON CONFLICT (location_id, competitor_id)
            DO UPDATE SET
                strengths = ${JSON.stringify(strengths || [])},
                weaknesses = ${JSON.stringify(weaknesses || [])},
                updated_by = ${session.user.email},
                updated_at = NOW()
        `;

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[competitor-notes] Error:', error);
        return NextResponse.json({ error: 'Failed to save notes' }, { status: 500 });
    }
}
