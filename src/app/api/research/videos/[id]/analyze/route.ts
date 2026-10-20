/**
 * POST /api/research/videos/:id/analyze   { withTranscript?: boolean }
 *
 * "Why it worked": hook type, beats, format. Each video is analyzed once and
 * the result is stored; later calls return the stored copy for free.
 * withTranscript pulls the transcript first (Instagram ≈ $0.03, TikTok ≈ $0.01
 * via Apify), also stored so it's paid once. YouTube has no transcript route.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sql } from '@/lib/db/sql';
import { ensureContentResearchTables } from '@/lib/db';
import { claudeJson, RESEARCH_MODEL } from '@/lib/content-research/claude';
import { ANALYSIS_SCHEMA, ANALYSIS_SYSTEM, buildAnalysisPrompt, type VideoAnalysis } from '@/lib/content-research/prompts';
import { fetchTranscript, researchConfig } from '@/lib/content-research/scrape';

export const maxDuration = 180;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const id = Number((await params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Bad video id' }, { status: 400 });
    const body = await req.json().catch(() => ({}));

    try {
        await ensureContentResearchTables();
        const { rows: cached } = await sql`SELECT analysis, model, transcript_used, created_at FROM research_video_analyses WHERE video_id = ${id}`;
        if (cached.length > 0) return NextResponse.json({ ...cached[0], cached: true });

        const config = researchConfig();
        if (!config.anthropic) return NextResponse.json({ error: 'Not configured: add ANTHROPIC_API_KEY to analyze videos.' }, { status: 409 });

        const { rows } = await sql`
            SELECT v.platform, v.url, v.caption, v.views, v.duration_sec, v.transcript, w.handle, w.median_views
            FROM research_videos v JOIN research_watchlist w ON w.id = v.account_id WHERE v.id = ${id}
        `;
        const v = rows[0];
        if (!v) return NextResponse.json({ error: 'Video not found' }, { status: 404 });

        let transcript: string | null = v.transcript;
        let transcriptNote: string | null = null;
        if (!transcript && body.withTranscript) {
            if (v.platform === 'youtube') transcriptNote = 'YouTube transcripts are not available; analyzed from the title and description.';
            else if (!config.apify) transcriptNote = 'Apify is not configured, so no transcript; analyzed from the caption.';
            else {
                const t = await fetchTranscript(v.platform, v.url);
                transcript = t.text;
                if (transcript) await sql`UPDATE research_videos SET transcript = ${transcript}, transcript_source = ${t.source} WHERE id = ${id}`;
                else transcriptNote = 'No speech transcript came back; analyzed from the caption.';
            }
        }

        const views = v.views === null ? null : Number(v.views);
        const med = v.median_views === null ? null : Number(v.median_views);
        const analysis = await claudeJson<VideoAnalysis>({
            system: ANALYSIS_SYSTEM,
            prompt: buildAnalysisPrompt({
                platform: v.platform, accountHandle: v.handle, caption: v.caption ?? '', transcript,
                views, accountMedian: med, score: views !== null && med ? Math.round((views / med) * 10) / 10 : null,
                durationSec: v.duration_sec,
            }),
            schema: ANALYSIS_SCHEMA,
        });

        await sql`
            INSERT INTO research_video_analyses (video_id, model, analysis, transcript_used, created_by)
            VALUES (${id}, ${RESEARCH_MODEL}, ${sql.json(analysis)}, ${!!transcript}, ${session.user.email})
            ON CONFLICT (video_id) DO NOTHING
        `;
        return NextResponse.json({ analysis, model: RESEARCH_MODEL, transcript_used: !!transcript, transcriptNote, cached: false });
    } catch (error) {
        console.error('[research/analyze] failed:', error);
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Analysis failed' }, { status: 500 });
    }
}
