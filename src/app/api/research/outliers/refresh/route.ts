/**
 * POST /api/research/outliers/refresh   { confirm?: boolean }
 *
 * Paid. Only runs when a person clicks Refresh, never on page load.
 * Without confirm it returns the plan and estimated Apify cost. With confirm it
 * scrapes up to 20 stale accounts (not scraped in 7 days), 20 videos each, in
 * one batched Apify run per platform, then refreshes each account's median.
 * A 1-hour cooldown between runs (failed ones too, since Apify may still have
 * billed them) stops double clicks from double billing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sql } from '@/lib/db/sql';
import { ensureContentResearchTables } from '@/lib/db';
import { planRefresh, estimateCost, VIDEOS_PER_ACCOUNT } from '@/lib/content-research/plan';
import { median } from '@/lib/content-research/outlier';
import { accountKey, type Platform } from '@/lib/content-research/watchlist';
import type { ScrapedVideo } from '@/lib/content-research/normalize';
import {
    isPlatformConfigured, researchConfig, scrapeInstagramReels, scrapeTikTokProfiles, fetchYouTubeShorts,
} from '@/lib/content-research/scrape';

export const maxDuration = 300;

const COOLDOWN_MINUTES = 60;
const APIFY_TIMEOUT_MS = 240_000;

interface AccountRow { id: number; platform: Platform; handle: string; lastScrapedAt: string | null; active: boolean }

export async function POST(req: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const config = researchConfig();

    if (!config.apify && !config.youtube) {
        return NextResponse.json({ error: 'Not configured: add APIFY_API_TOKEN (Instagram, TikTok) or YOUTUBE_API_KEY (YouTube Shorts).', configured: config }, { status: 409 });
    }

    await ensureContentResearchTables();

    const { rows: recent } = await sql`
        SELECT started_at FROM research_scrape_runs
        WHERE started_at > NOW() - make_interval(mins => ${COOLDOWN_MINUTES})        ORDER BY started_at DESC LIMIT 1
    `;
    if (recent.length > 0) {
        return NextResponse.json({ error: `A refresh ran in the last ${COOLDOWN_MINUTES} minutes. Try again later.` }, { status: 429 });
    }

    const { rows } = await sql<AccountRow>`
        SELECT id, platform, handle, last_scraped_at AS "lastScrapedAt", active FROM research_watchlist
    `;
    const plan = planRefresh(rows.filter(a => isPlatformConfigured(a.platform)), new Date());
    const summary = {
        accounts: plan.accounts.length,
        byPlatform: countBy(plan.accounts.map(a => a.platform)),
        videosPerAccount: plan.videosPerAccount,
        estCostUsd: plan.estCostUsd,
        skippedUnconfigured: rows.filter(a => a.active && !isPlatformConfigured(a.platform)).length,
    };
    if (plan.accounts.length === 0) return NextResponse.json({ ran: false, plan: summary, message: 'Every account was refreshed in the last 7 days.' });
    if (!body.confirm) return NextResponse.json({ ran: false, plan: summary });

    const byPlatform = (p: Platform) => plan.accounts.filter(a => a.platform === p);
    const results = await Promise.allSettled([
        runPlatform('instagram', byPlatform('instagram'), session.user.email, handles => scrapeInstagramReels(handles, plan.videosPerAccount, APIFY_TIMEOUT_MS)),
        runPlatform('tiktok', byPlatform('tiktok'), session.user.email, handles => scrapeTikTokProfiles(handles, plan.videosPerAccount, APIFY_TIMEOUT_MS)),
        runPlatform('youtube', byPlatform('youtube'), session.user.email, async handles => {
            const videos: ScrapedVideo[] = [];
            const errors: { input: string; message: string }[] = [];
            for (const h of handles) {
                try { videos.push(...await fetchYouTubeShorts(h)); }
                catch (e) { errors.push({ input: h, message: e instanceof Error ? e.message : String(e) }); }
            }
            return { videos, errors };
        }),
    ]);

    const report = results.map(r => r.status === 'fulfilled' ? r.value : { error: String(r.reason) });
    return NextResponse.json({ ran: true, plan: summary, report });
}

async function runPlatform(
    platform: Platform,
    accounts: AccountRow[],
    user: string,
    scrape: (handles: string[]) => Promise<{ videos: ScrapedVideo[]; errors: { input: string; message: string }[] }>,
) {
    if (accounts.length === 0) return { platform, videos: 0 };
    const { rows: [run] } = await sql`
        INSERT INTO research_scrape_runs (platform, account_count, est_cost_usd, started_by)
        VALUES (${platform}, ${accounts.length}, ${estimateCost({ instagram: 0, tiktok: 0, youtube: 0, [platform]: accounts.length * VIDEOS_PER_ACCOUNT })}, ${user})
        RETURNING id
    `;
    try {
        const { videos, errors } = await scrape(accounts.map(a => a.handle));
        const idByKey = new Map(accounts.map(a => [accountKey(a.platform, a.handle), a.id]));
        let saved = 0;
        for (const v of videos) {
            const accountId = idByKey.get(accountKey(platform, v.accountHandle));
            if (!accountId) continue;
            await sql`
                INSERT INTO research_videos (platform, external_id, account_id, url, caption, views, likes, comments, shares,
                    duration_sec, posted_at, thumbnail_url, transcript, transcript_source, scraped_at)
                VALUES (${platform}, ${v.externalId}, ${accountId}, ${v.url}, ${v.caption}, ${v.views}, ${v.likes}, ${v.comments}, ${v.shares},
                    ${v.durationSec}, ${v.postedAt}, ${v.thumbnailUrl}, ${v.transcript}, ${v.transcript ? 'scrape' : null}, NOW())
                ON CONFLICT (platform, external_id) DO UPDATE SET
                    views = EXCLUDED.views, likes = EXCLUDED.likes, comments = EXCLUDED.comments, shares = EXCLUDED.shares,
                    caption = EXCLUDED.caption, thumbnail_url = EXCLUDED.thumbnail_url, scraped_at = NOW(),
                    transcript = COALESCE(research_videos.transcript, EXCLUDED.transcript),
                    transcript_source = COALESCE(research_videos.transcript_source, EXCLUDED.transcript_source)
            `;
            saved++;
        }

        const ids = accounts.map(a => a.id);
        const { rows: viewRows } = await sql<{ account_id: number; views: string | null }>`
            SELECT account_id, views FROM research_videos WHERE account_id = ANY(${ids}::int[])
        `;
        for (const a of accounts) {
            const views = viewRows.filter(r => r.account_id === a.id && r.views !== null).map(r => Number(r.views));
            const err = errors.find(e => e.input.toLowerCase().includes(a.handle.toLowerCase()));
            await sql`
                UPDATE research_watchlist SET last_scraped_at = NOW(), median_views = ${median(views)},
                    video_count = ${views.length}, last_error = ${err?.message ?? null}
                WHERE id = ${a.id}
            `;
        }
        await sql`
            UPDATE research_scrape_runs SET status = 'done', item_count = ${videos.length},
                est_cost_usd = ${estimateCost({ instagram: 0, tiktok: 0, youtube: 0, [platform]: videos.length })}, finished_at = NOW()
            WHERE id = ${run.id}
        `;
        return { platform, videos: saved, errors: errors.length };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[research/refresh] ${platform} failed:`, message);
        await sql`UPDATE research_scrape_runs SET status = 'failed', error = ${message}, finished_at = NOW() WHERE id = ${run.id}`;
        return { platform, videos: 0, error: message };
    }
}

function countBy(values: string[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const v of values) out[v] = (out[v] ?? 0) + 1;
    return out;
}
