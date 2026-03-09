/**
 * /api/cron/analyze-conversations
 * Daily cron: Refreshes conversation intelligence for all locations.
 * Stores per-contact lifecycle data in Postgres cache for SMS campaign use.
 *
 * Vercel cron runs this daily at 6 AM EST.
 * Can also be triggered manually (admin-only).
 *
 * Runtime: Up to 5 minutes (Vercel Pro function timeout).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getConversationsIntelligence } from '@/lib/integrations/ghl-conversations';
import { pgCacheSet } from '@/lib/pg-cache';

export const maxDuration = 300; // 5 minutes

export async function GET(req: NextRequest) {
    // Verify caller: cron secret OR admin session
    const cronSecret = req.headers.get('authorization')?.replace('Bearer ', '');
    const isVercelCron = cronSecret === process.env.CRON_SECRET;

    if (!isVercelCron) {
        const session = await getServerSession(authOptions);
        const user = session?.user as Record<string, unknown> | undefined;
        if (!user?.isAdmin) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
    }

    const startTime = Date.now();
    const results: Record<string, { contacts: number; ghost: number; engaged: number; error?: string }> = {};

    try {
        // Analyze all locations (no filter = all)
        console.log('[cron/analyze-conversations] Starting full analysis...');
        const intelligence = await getConversationsIntelligence({ forceRefresh: true });

        // Store per-contact lifecycle data in Postgres for campaign segments
        const contactLifecycles: Record<string, {
            contactId: string;
            contactName: string;
            phone: string;
            email: string;
            locationKey: string;
            lifecycleStage: string;
            isDND: boolean;
        }[]> = { ghost: [], engaged: [], quoted: [], untouched: [], attempted: [] };

        for (const gap of intelligence.engagementGaps) {
            const stage = gap.engagement?.lifecycleStage;
            if (!stage || !contactLifecycles[stage]) continue;
            contactLifecycles[stage].push({
                contactId: gap.opportunity.contactId,
                contactName: gap.opportunity.contactName,
                phone: gap.engagement?.phone || '',
                email: gap.opportunity.contactEmail || '',
                locationKey: gap.locationKey,
                lifecycleStage: stage,
                isDND: gap.engagement?.isDND || false,
            });
        }

        // Cache each lifecycle segment separately for fast lookups
        for (const [stage, contacts] of Object.entries(contactLifecycles)) {
            if (contacts.length > 0) {
                await pgCacheSet(`conversation_${stage}`, contacts, 3); // 3-day TTL
            }
        }

        results['all'] = {
            contacts: intelligence.engagementGaps.length,
            ghost: contactLifecycles.ghost.length,
            engaged: contactLifecycles.engaged.length,
        };

        const durationMs = Date.now() - startTime;
        console.log(`[cron/analyze-conversations] Complete in ${Math.round(durationMs / 1000)}s — ${intelligence.engagementGaps.length} contacts analyzed`);

        return NextResponse.json({
            success: true,
            durationMs,
            results,
            summary: intelligence.summary,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[cron/analyze-conversations] Error:', message);
        return NextResponse.json({
            success: false,
            error: message,
            durationMs: Date.now() - startTime,
            results,
        }, { status: 500 });
    }
}
