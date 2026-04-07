/**
 * Search Console Sync — Backfill + Incremental
 * Fetches GSC query data and stores in search_console_daily table.
 * Follows the same chunked backfill pattern as mindbody-sync.ts.
 */

import { sql } from '@vercel/postgres';
import { subDays, format, addDays } from 'date-fns';
import { google } from 'googleapis';
import { isGscConfigured } from './search-console';

const BACKFILL_DAYS = 180; // 6 months of history
const CHUNK_DAYS = 30; // 30-day windows per chunk

interface SyncResult {
    total: number;
    apiCalls: number;
    done: boolean;
    chunkLabel: string;
    continue?: boolean;
}

function getAuthClient() {
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
    const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    if (!clientEmail || !privateKey) {
        throw new Error('Missing Google Auth credentials');
    }
    return new google.auth.JWT({
        email: clientEmail,
        key: privateKey,
        scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
    });
}

/**
 * Fetch query-level data for a date range and upsert into search_console_daily.
 * Uses dimensions: ['date', 'query'] to get per-date per-query breakdowns.
 */
async function fetchAndStoreQueries(
    startDate: string,
    endDate: string,
): Promise<{ inserted: number; apiCalls: number }> {
    const authClient = getAuthClient();
    const searchconsole = google.searchconsole({ version: 'v1', auth: authClient });
    const siteUrl = process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL || 'sc-domain:chinupaesthetics.com';

    const response = await searchconsole.searchanalytics.query({
        siteUrl,
        requestBody: {
            startDate,
            endDate,
            dimensions: ['date', 'query'],
            rowLimit: 5000,
        },
    });

    const rows = response.data.rows || [];
    let inserted = 0;

    for (const row of rows) {
        const metricDate = row.keys?.[0] || '';
        const query = row.keys?.[1] || '';
        const clicks = row.clicks || 0;
        const impressions = row.impressions || 0;
        const ctr = row.ctr || 0;
        const position = row.position || 0;

        if (!metricDate || !query) continue;

        await sql`
            INSERT INTO search_console_daily (metric_date, query, page, clicks, impressions, ctr, position)
            VALUES (${metricDate}, ${query}, NULL, ${clicks}, ${impressions}, ${ctr}, ${position})
            ON CONFLICT (metric_date, query, page) DO UPDATE SET
                clicks = EXCLUDED.clicks,
                impressions = EXCLUDED.impressions,
                ctr = EXCLUDED.ctr,
                position = EXCLUDED.position
        `;
        inserted++;
    }

    return { inserted, apiCalls: 1 };
}

/**
 * Chunked backfill — goes back 180 days in 30-day windows.
 * Call repeatedly while result.done === false.
 */
export async function backfillSearchConsole(): Promise<SyncResult> {
    if (!isGscConfigured()) {
        return { total: 0, apiCalls: 0, done: true, chunkLabel: 'Search Console not configured — skipped' };
    }

    // Check if already complete
    const doneCheck = await sql`SELECT sync_type FROM mb_sync_state WHERE sync_type = 'search_console'`;
    if (doneCheck.rows.length > 0) {
        return { total: 0, apiCalls: 0, done: true, chunkLabel: 'Search Console backfill already complete' };
    }

    // Load progress
    const progressRow = await sql`SELECT * FROM mb_sync_state WHERE sync_type = 'search_console_backfill_progress'`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let cursor: any = {};
    try { if (progressRow.rows[0]?.cursor_data) cursor = JSON.parse(progressRow.rows[0].cursor_data); } catch { /* invalid JSON */ }
    const previousTotal = Number(progressRow.rows[0]?.total_records || 0);

    // Calculate date window
    // GSC data is 2 days delayed
    const today = new Date();
    const dataEndDate = subDays(today, 2);
    const absoluteStart = subDays(today, BACKFILL_DAYS + 2);

    // Where did we leave off? Start from cursor or from the beginning
    const chunkStart = cursor.nextStartDate
        ? new Date(cursor.nextStartDate)
        : absoluteStart;

    // If chunkStart is past the data end, we're done
    if (chunkStart >= dataEndDate) {
        const countRes = await sql`SELECT COUNT(*)::int AS cnt FROM search_console_daily`;
        const totalCount = countRes.rows[0]?.cnt || 0;

        await sql`
            INSERT INTO mb_sync_state (sync_type, last_sync_date, total_records, updated_at)
            VALUES ('search_console', CURRENT_DATE, ${totalCount}, NOW())
            ON CONFLICT (sync_type) DO UPDATE SET
                last_sync_date = CURRENT_DATE,
                total_records = ${totalCount},
                updated_at = NOW()
        `;
        await sql`DELETE FROM mb_sync_state WHERE sync_type = 'search_console_backfill_progress'`;

        return {
            total: 0,
            apiCalls: 0,
            done: true,
            chunkLabel: `Backfill complete — ${totalCount} total query rows stored`,
        };
    }

    const chunkEnd = new Date(Math.min(addDays(chunkStart, CHUNK_DAYS).getTime(), dataEndDate.getTime()));
    const startDateStr = format(chunkStart, 'yyyy-MM-dd');
    const endDateStr = format(chunkEnd, 'yyyy-MM-dd');

    const { inserted, apiCalls } = await fetchAndStoreQueries(startDateStr, endDateStr);

    const newTotal = previousTotal + inserted;
    const nextStartDate = format(addDays(chunkEnd, 1), 'yyyy-MM-dd');
    const isComplete = addDays(chunkEnd, 1) >= dataEndDate;

    if (isComplete) {
        const countRes = await sql`SELECT COUNT(*)::int AS cnt FROM search_console_daily`;
        const totalCount = countRes.rows[0]?.cnt || 0;

        await sql`
            INSERT INTO mb_sync_state (sync_type, last_sync_date, total_records, updated_at)
            VALUES ('search_console', CURRENT_DATE, ${totalCount}, NOW())
            ON CONFLICT (sync_type) DO UPDATE SET
                last_sync_date = CURRENT_DATE,
                total_records = ${totalCount},
                updated_at = NOW()
        `;
        await sql`DELETE FROM mb_sync_state WHERE sync_type = 'search_console_backfill_progress'`;

        return {
            total: inserted,
            apiCalls,
            done: true,
            chunkLabel: `Backfill complete — ${totalCount} total query rows stored`,
        };
    }

    // Save progress
    const cursorJson = JSON.stringify({ nextStartDate });
    await sql`
        INSERT INTO mb_sync_state (sync_type, last_sync_date, total_records, cursor_data, updated_at)
        VALUES ('search_console_backfill_progress', CURRENT_DATE, ${newTotal}, ${cursorJson}, NOW())
        ON CONFLICT (sync_type) DO UPDATE SET
            total_records = ${newTotal},
            cursor_data = ${cursorJson},
            updated_at = NOW()
    `;

    return {
        total: inserted,
        apiCalls,
        done: false,
        chunkLabel: `Stored ${inserted} rows for ${startDateStr} to ${endDateStr} (${newTotal} total)`,
        continue: true,
    };
}

/**
 * Incremental sync — fetches last 5 days of data (2-day delay + 3 overlap).
 */
export async function incrementalSearchConsoleSync(): Promise<SyncResult> {
    if (!isGscConfigured()) {
        return { total: 0, apiCalls: 0, done: true, chunkLabel: 'Search Console not configured — skipped' };
    }

    const endDate = format(subDays(new Date(), 2), 'yyyy-MM-dd');
    const startDate = format(subDays(new Date(), 7), 'yyyy-MM-dd'); // 5 days of data with overlap

    const { inserted, apiCalls } = await fetchAndStoreQueries(startDate, endDate);

    await sql`
        INSERT INTO mb_sync_state (sync_type, last_sync_date, total_records, updated_at)
        VALUES ('search_console', CURRENT_DATE, (SELECT COUNT(*)::int FROM search_console_daily), NOW())
        ON CONFLICT (sync_type) DO UPDATE SET
            last_sync_date = CURRENT_DATE,
            total_records = (SELECT COUNT(*)::int FROM search_console_daily),
            updated_at = NOW()
    `;

    return {
        total: inserted,
        apiCalls,
        done: true,
        chunkLabel: `Synced ${inserted} query rows (${startDate} to ${endDate})`,
    };
}

/**
 * Get sync stats for search console data.
 */
export async function getSearchConsoleStats(): Promise<{
    totalRows: number;
    lastSync: string | null;
    dateRange: { earliest: string | null; latest: string | null };
}> {
    const [countRes, stateRes, rangeRes] = await Promise.all([
        sql`SELECT COUNT(*)::int AS cnt FROM search_console_daily`,
        sql`SELECT last_sync_date FROM mb_sync_state WHERE sync_type = 'search_console'`,
        sql`SELECT MIN(metric_date)::text AS earliest, MAX(metric_date)::text AS latest FROM search_console_daily`,
    ]);

    return {
        totalRows: countRes.rows[0]?.cnt || 0,
        lastSync: stateRes.rows[0]?.last_sync_date || null,
        dateRange: {
            earliest: rangeRes.rows[0]?.earliest || null,
            latest: rangeRes.rows[0]?.latest || null,
        },
    };
}
