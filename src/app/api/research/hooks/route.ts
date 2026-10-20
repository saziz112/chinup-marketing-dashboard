/**
 * GET  /api/research/hooks   Chin Up offer presets (with their sources).
 * POST /api/research/hooks   { treatment, price, details?, aliases?, videoId?, count? }
 *
 * Writes "clear over clever" hooks + one script for a real Chin Up offer.
 * The price is required and is never filled in for the user: if it's missing
 * or unreadable the request fails. Every hook is checked server-side for the
 * treatment name, the exact $ price, and a 5th-grade reading level.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sql } from '@/lib/db/sql';
import { ensureContentResearchTables } from '@/lib/db';
import { claudeJson } from '@/lib/content-research/claude';
import { parsePrice, validateHook, type HookOffer } from '@/lib/content-research/hooks';
import { CHINUP_OFFERS } from '@/lib/content-research/offers';
import { HOOK_SCHEMA, HOOK_SYSTEM, buildHookPrompt, type HookDraft, type VideoAnalysis } from '@/lib/content-research/prompts';

export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ offers: CHINUP_OFFERS, anthropicConfigured: !!process.env.ANTHROPIC_API_KEY });
}

export async function POST(req: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const treatment = String(body.treatment ?? '').trim();
    if (!treatment) return NextResponse.json({ error: 'Enter the treatment name.' }, { status: 400 });
    const price = parsePrice(String(body.price ?? ''));
    if (price === null) return NextResponse.json({ error: 'Enter the real price, like $199. We never guess a price.' }, { status: 400 });
    if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: 'Not configured: add ANTHROPIC_API_KEY to write hooks.' }, { status: 409 });

    const offer: HookOffer & { details?: string } = {
        treatment,
        price,
        aliases: Array.isArray(body.aliases) ? body.aliases.map(String).filter(Boolean) : undefined,
        details: body.details ? String(body.details).slice(0, 500) : undefined,
    };
    const count = Math.min(Math.max(Number(body.count) || 6, 3), 10);

    try {
        let inspiration: VideoAnalysis | undefined;
        if (body.videoId) {
            await ensureContentResearchTables();
            const { rows } = await sql`SELECT analysis FROM research_video_analyses WHERE video_id = ${Number(body.videoId)}`;
            inspiration = rows[0]?.analysis;
        }

        const draft = await claudeJson<HookDraft>({
            system: HOOK_SYSTEM,
            prompt: buildHookPrompt(offer, count, inspiration),
            schema: HOOK_SCHEMA,
        });

        const hooks = draft.hooks
            .map(text => ({ text, check: validateHook(text, offer) }))
            .sort((a, b) => Number(b.check.ok) - Number(a.check.ok));
        return NextResponse.json({
            offer: { treatment, price },
            hooks,
            script: { ...draft.script, check: validateHook(draft.script.hook, offer) },
        });
    } catch (error) {
        console.error('[research/hooks] failed:', error);
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Hook writing failed' }, { status: 500 });
    }
}
