/**
 * Vercel Cron: upload paid Zenoti visits to Google Ads as offline click conversions
 * (via the Data Manager API).
 *
 * Runs daily at 10:00 UTC (vercel.json), after the 08:00 Zenoti sync. Logic, rules and
 * idempotency live in lib/integrations/google-offline-conversions.ts.
 *
 * Auth: CRON_SECRET bearer (Vercel cron) or an admin session (manual run).
 * `?validateOnly=1` asks Google to validate without importing and records nothing.
 *
 * Responses: 200 ok:true on a run; 200 ok:false skipped:true when env is missing
 * (logged, reason in body); 502 when Google rejects the request as a whole.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isCronAuthorized } from '@/lib/cron-auth';
import { runOfflineConversionUpload } from '@/lib/integrations/google-offline-conversions';

export const maxDuration = 60;

export async function GET(req: NextRequest) {
    if (!isCronAuthorized(req.headers.get('authorization'))) {
        const session = await getServerSession(authOptions);
        const user = session?.user as Record<string, unknown> | undefined;
        if (!user || user.isAdmin !== true) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
    }

    const validateOnly = req.nextUrl.searchParams.get('validateOnly') === '1';
    const result = await runOfflineConversionUpload({ validateOnly });
    const failedRequest = !result.ok && !result.skipped;
    return NextResponse.json(result, { status: failedRequest ? 502 : 200 });
}
