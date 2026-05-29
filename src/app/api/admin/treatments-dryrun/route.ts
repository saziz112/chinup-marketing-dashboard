/**
 * TEMPORARY dry-run for sales-derived treatment normalization.
 * Shows the resulting treatment dropdown + how each raw sales description maps
 * to a canonical clinical treatment (or is excluded). DELETE after review.
 * Session-guarded.
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sql } from '@/lib/db/sql';
import { normalizeTreatment } from '@/lib/treatments';
import { getAvailableTreatments } from '@/lib/integrations/mindbody-sync';

export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const treatments = await getAvailableTreatments();

    const raw = await sql`
        SELECT item->>'Description' AS descr,
               COUNT(DISTINCT s.client_id) AS clients
        FROM mb_sales_history s, jsonb_array_elements(s.items_json) item
        WHERE jsonb_typeof(s.items_json) = 'array'
          AND item->>'Description' IS NOT NULL
        GROUP BY descr
        ORDER BY clients DESC
        LIMIT 120
    `;

    const mapped: Array<{ raw: string; clients: number; canonical: string }> = [];
    const excluded: Array<{ raw: string; clients: number }> = [];
    for (const r of raw.rows) {
        const t = normalizeTreatment(r.descr);
        if (t) mapped.push({ raw: r.descr, clients: Number(r.clients), canonical: t });
        else excluded.push({ raw: r.descr, clients: Number(r.clients) });
    }

    return NextResponse.json({
        treatmentDropdown: treatments,
        mappedSample: mapped,
        excludedSample: excluded.slice(0, 40),
    });
}
