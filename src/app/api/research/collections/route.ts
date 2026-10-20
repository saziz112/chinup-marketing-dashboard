/**
 * GET    /api/research/collections            saved ideas, newest first
 * POST   /api/research/collections            { collection?, kind: 'video'|'hook'|'script', title, body?, videoId? }
 * DELETE /api/research/collections?id=3
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sql } from '@/lib/db/sql';
import { ensureContentResearchTables } from '@/lib/db';

const KINDS = ['video', 'hook', 'script'];

export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    try {
        await ensureContentResearchTables();
        const { rows } = await sql`
            SELECT i.id, i.collection, i.kind, i.video_id, i.title, i.body, i.created_by, i.created_at,
                   v.url AS video_url, v.platform AS video_platform
            FROM research_saved_ideas i LEFT JOIN research_videos v ON v.id = i.video_id
            ORDER BY i.created_at DESC LIMIT 300
        `;
        return NextResponse.json({ items: rows });
    } catch (error) {
        console.error('[research/collections] GET failed:', error);
        return NextResponse.json({ error: 'Failed to load collections' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const title = String(body.title ?? '').trim().slice(0, 500);
    if (!KINDS.includes(body.kind) || !title) return NextResponse.json({ error: 'Need a kind and a title' }, { status: 400 });
    const collection = String(body.collection ?? '').trim().slice(0, 100) || 'Winners';
    const videoId = Number(body.videoId) > 0 ? Number(body.videoId) : null;

    try {
        await ensureContentResearchTables();
        const { rows } = await sql`
            INSERT INTO research_saved_ideas (collection, kind, video_id, title, body, created_by)
            VALUES (${collection}, ${body.kind}, ${videoId}, ${title}, ${sql.json(body.body ?? {})}, ${session.user.email})
            RETURNING id, collection, kind, video_id, title, body, created_by, created_at
        `;
        return NextResponse.json({ item: rows[0] });
    } catch (error) {
        console.error('[research/collections] POST failed:', error);
        return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const id = Number(req.nextUrl.searchParams.get('id'));
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    try {
        await ensureContentResearchTables();
        await sql`DELETE FROM research_saved_ideas WHERE id = ${id}`;
        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error('[research/collections] DELETE failed:', error);
        return NextResponse.json({ error: 'Failed to remove' }, { status: 500 });
    }
}
