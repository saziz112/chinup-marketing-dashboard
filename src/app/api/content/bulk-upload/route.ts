/**
 * /api/content/bulk-upload
 * POST: Parse CSV and either preview or create scheduled posts
 *
 * CSV format: date,time,platforms,post_type,caption,media_url,gbp_locations
 *   - platforms pipe-separated: instagram|facebook
 *   - gbp_locations pipe-separated: decatur|smyrna
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createPost, Platform } from '@/lib/content-publisher';

const MAX_ROWS = 21; // 3/day x 7 days

const VALID_PLATFORMS = new Set(['instagram', 'facebook', 'google-business', 'youtube']);
const VALID_POST_TYPES = new Set(['feed', 'reel', 'story']);
const VALID_GBP_LOCS = new Set(['decatur', 'smyrna', 'kennesaw']);

interface CsvRow {
    line: number;
    date: string;
    time: string;
    platforms: string[];
    postType: string;
    caption: string;
    mediaUrl: string;
    gbpLocations: string[];
    errors: string[];
}

function parseCSV(text: string): string[][] {
    const rows: string[][] = [];
    let current = '';
    let inQuotes = false;
    let row: string[] = [];

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"' && text[i + 1] === '"') {
                current += '"';
                i++;
            } else if (ch === '"') {
                inQuotes = false;
            } else {
                current += ch;
            }
        } else {
            if (ch === '"') {
                inQuotes = true;
            } else if (ch === ',') {
                row.push(current.trim());
                current = '';
            } else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
                row.push(current.trim());
                current = '';
                if (row.some(cell => cell !== '')) rows.push(row);
                row = [];
                if (ch === '\r') i++;
            } else {
                current += ch;
            }
        }
    }
    row.push(current.trim());
    if (row.some(cell => cell !== '')) rows.push(row);
    return rows;
}

function validateRow(cells: string[], lineNum: number): CsvRow {
    const errors: string[] = [];

    const [date, time, platformsRaw, postType, caption, mediaUrl, gbpRaw] = cells;

    // Date
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        errors.push('Invalid date format (use YYYY-MM-DD)');
    }

    // Time
    if (!time || !/^\d{2}:\d{2}$/.test(time)) {
        errors.push('Invalid time format (use HH:MM)');
    }

    // Platforms
    const platforms = (platformsRaw || '').split('|').map(p => p.trim().toLowerCase()).filter(Boolean);
    if (platforms.length === 0) {
        errors.push('At least one platform is required');
    }
    for (const p of platforms) {
        if (!VALID_PLATFORMS.has(p)) {
            errors.push(`Unknown platform: ${p}`);
        }
    }

    // Post type
    const pt = (postType || 'feed').trim().toLowerCase();
    if (!VALID_POST_TYPES.has(pt)) {
        errors.push(`Invalid post_type: ${pt}`);
    }

    // Caption
    if (!caption) {
        errors.push('Caption is required');
    }

    // GBP locations
    const gbpLocations = (gbpRaw || '').split('|').map(l => l.trim().toLowerCase()).filter(Boolean);
    if (platforms.includes('google-business') && gbpLocations.length === 0) {
        errors.push('GBP locations required when posting to google-business');
    }
    for (const loc of gbpLocations) {
        if (!VALID_GBP_LOCS.has(loc)) {
            errors.push(`Unknown GBP location: ${loc}`);
        }
    }

    // Future date check
    if (date && time && !errors.some(e => e.includes('Invalid date') || e.includes('Invalid time'))) {
        const scheduledDate = new Date(`${date}T${time}:00`);
        if (scheduledDate <= new Date()) {
            errors.push('Scheduled date/time must be in the future');
        }
    }

    return {
        line: lineNum,
        date: date || '',
        time: time || '',
        platforms,
        postType: pt,
        caption: caption || '',
        mediaUrl: (mediaUrl || '').trim(),
        gbpLocations,
        errors,
    };
}

export async function POST(req: Request) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await req.json();
        const { csv, action } = body; // action: 'preview' | 'confirm'

        if (!csv || typeof csv !== 'string') {
            return NextResponse.json({ error: 'CSV content is required' }, { status: 400 });
        }

        const allRows = parseCSV(csv);

        // Skip header row if it looks like headers
        const firstRow = allRows[0];
        const hasHeader = firstRow && (
            firstRow[0]?.toLowerCase() === 'date' ||
            firstRow[0]?.toLowerCase() === 'scheduled_date'
        );
        const dataRows = hasHeader ? allRows.slice(1) : allRows;

        if (dataRows.length === 0) {
            return NextResponse.json({ error: 'No data rows found in CSV' }, { status: 400 });
        }

        if (dataRows.length > MAX_ROWS) {
            return NextResponse.json({
                error: `Too many rows (${dataRows.length}). Maximum is ${MAX_ROWS} posts per upload.`,
            }, { status: 400 });
        }

        // Validate all rows
        const parsed = dataRows.map((cells, i) => validateRow(cells, i + (hasHeader ? 2 : 1)));
        const valid = parsed.filter(r => r.errors.length === 0);
        const invalid = parsed.filter(r => r.errors.length > 0);

        if (action === 'preview') {
            return NextResponse.json({
                totalRows: parsed.length,
                validCount: valid.length,
                invalidCount: invalid.length,
                rows: parsed.map(r => ({
                    line: r.line,
                    date: r.date,
                    time: r.time,
                    platforms: r.platforms,
                    postType: r.postType,
                    caption: r.caption.substring(0, 100) + (r.caption.length > 100 ? '...' : ''),
                    mediaUrl: r.mediaUrl || null,
                    gbpLocations: r.gbpLocations,
                    valid: r.errors.length === 0,
                    errors: r.errors,
                })),
            });
        }

        if (action === 'confirm') {
            const created: string[] = [];
            const failed: { line: number; error: string }[] = [];

            for (const row of valid) {
                try {
                    const scheduledFor = new Date(`${row.date}T${row.time}:00`).toISOString();
                    await createPost({
                        platforms: row.platforms as Platform[],
                        caption: row.caption,
                        mediaUrls: row.mediaUrl ? [row.mediaUrl] : [],
                        postType: row.postType as any,
                        scheduledFor,
                        gbpLocations: row.gbpLocations.length > 0 ? row.gbpLocations : undefined,
                        createdBy: session.user?.email || undefined,
                    });
                    created.push(`Row ${row.line}`);
                } catch (err: any) {
                    failed.push({ line: row.line, error: err.message || 'Creation failed' });
                }
            }

            return NextResponse.json({
                created: created.length,
                failed: failed.length,
                skippedInvalid: invalid.length,
                details: { created, failed },
            });
        }

        return NextResponse.json({ error: 'action must be "preview" or "confirm"' }, { status: 400 });
    } catch (error: any) {
        console.error('[Bulk Upload] Error:', error);
        return NextResponse.json({ error: error.message || 'Bulk upload failed' }, { status: 500 });
    }
}
