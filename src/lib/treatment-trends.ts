/**
 * Treatment booking-volume trend, sourced from mb_sales_history.items_json.
 *
 * WHY NOT mb_appointments_history.session_type_name: that column is NULL for all
 * MindBody rows (≤2026-06-30) and is only populated with raw, un-normalized Zenoti
 * strings (≥7/1) — e.g. "Dysport - Per Unit", "New Botox Patient", "Follow-Up Visit",
 * "B12 Shot". Grouping on it splits one treatment across many labels, mixes in
 * non-treatment noise, and gives no cross-cutover baseline (June = all NULL), so every
 * treatment falsely reads "+100% new". Sales line-item descriptions span both sources
 * and normalize cleanly via normalizeTreatment().
 *
 * Comparison window is trailing-30d vs prior-30d (not this-calendar-month vs last),
 * which avoids the partial-current-month skew that made every treatment look down.
 * Counts are distinct sales per treatment per window (a multi-line Botox sale counts
 * once), a stable month-over-month volume proxy.
 */
import { sql } from '@/lib/db/sql';
import { normalizeTreatment } from '@/lib/treatments';

export interface TreatmentTrend {
    treatment: string;
    this_month: number; // trailing 30 days
    last_month: number; // prior 30 days
}

export async function getTreatmentTrends(limit = 15): Promise<{ rows: TreatmentTrend[] }> {
    const sales = (await sql<{ period: 'this' | 'last'; items_json: unknown }>`
        SELECT
            CASE WHEN sale_date >= CURRENT_DATE - 30 THEN 'this' ELSE 'last' END AS period,
            items_json
        FROM mb_sales_history
        WHERE sale_date >= CURRENT_DATE - 60 AND sale_date < CURRENT_DATE
            AND items_json IS NOT NULL
    `).rows;

    const agg = new Map<string, { this_month: number; last_month: number }>();
    for (const s of sales) {
        const items = Array.isArray(s.items_json) ? s.items_json : [];
        const treatments = new Set<string>();
        for (const it of items) {
            const desc = (it as Record<string, unknown>)?.Description ?? (it as Record<string, unknown>)?.description;
            const t = normalizeTreatment(typeof desc === 'string' ? desc : null);
            if (t) treatments.add(t);
        }
        for (const t of treatments) {
            if (!agg.has(t)) agg.set(t, { this_month: 0, last_month: 0 });
            const bucket = agg.get(t)!;
            if (s.period === 'this') bucket.this_month++;
            else bucket.last_month++;
        }
    }

    const rows = [...agg.entries()]
        .map(([treatment, v]) => ({ treatment, this_month: v.this_month, last_month: v.last_month }))
        .sort((a, b) => b.this_month - a.this_month)
        .slice(0, limit);

    return { rows };
}
