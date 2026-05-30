/**
 * TEMPORARY dry-run for the Treatment Maintenance Reminders segment.
 * Shows who's "due" per treatment (cadence windows) so we can validate the
 * cadences before wiring templates/sending. Session-guarded. DELETE after review.
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getMaintenanceDuePatients } from '@/lib/integrations/ghl-conversations';
import { TREATMENT_CADENCE } from '@/lib/treatments';

export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const due = await getMaintenanceDuePatients(undefined);

    // Group by treatment
    const byTreatment: Record<string, { total: number; ghlMatched: number; daysSince: number[]; sample: object[] }> = {};
    for (const p of due) {
        const g = (byTreatment[p.treatment] ||= { total: 0, ghlMatched: 0, daysSince: [], sample: [] });
        g.total++;
        if (p.ghlContactId) g.ghlMatched++;
        g.daysSince.push(p.daysSince);
        if (g.sample.length < 5) g.sample.push({ name: `${p.firstName} ${p.lastName}`.trim() || p.mbClientId, daysSince: p.daysSince, lastTreatment: p.lastTreatmentDate, lastSpend: p.totalRevenue, ghl: !!p.ghlContactId });
    }

    const summary = Object.entries(byTreatment).map(([treatment, g]) => ({
        treatment,
        cadenceWindow: TREATMENT_CADENCE[treatment],
        due: g.total,
        ghlMatched: g.ghlMatched,
        minDays: Math.min(...g.daysSince),
        maxDays: Math.max(...g.daysSince),
        sample: g.sample,
    })).sort((a, b) => b.due - a.due);

    return NextResponse.json({
        totalDue: due.length,
        totalGhlMatched: due.filter(p => p.ghlContactId).length,
        note: 'Future-booked (already-rebooked) patients are already excluded inside the function.',
        byTreatment: summary,
    });
}
