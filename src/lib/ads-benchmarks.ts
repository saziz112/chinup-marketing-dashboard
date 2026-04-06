/**
 * Med Spa Industry Benchmarks for Paid Ads
 *
 * Sources: WordStream Industry Benchmarks 2025, LocaliQ Health & Beauty,
 * Aesthetics Journal Digital Marketing Report 2025.
 *
 * These thresholds are calibrated for med spa / aesthetics businesses.
 * "good" = top quartile, "average" = median, below average = "poor".
 */

export type BenchmarkGrade = 'good' | 'average' | 'poor';

export interface MetricGrade {
    grade: BenchmarkGrade;
    value: number;
    label: string; // "Above Average", "Average", "Below Average"
    color: string; // hex color for UI
}

interface Thresholds {
    good: number;
    average: number;
    /** If true, lower values are better (cost metrics) */
    inverted?: boolean;
}

// --- Meta (Facebook/Instagram) Ads Benchmarks ---
const META_BENCHMARKS: Record<string, Thresholds> = {
    ctr:          { good: 1.5, average: 0.9 },           // % — med spa FB avg ~1.0%
    cpm:          { good: 12, average: 22, inverted: true },  // $ — lower is better
    cpc:          { good: 1.50, average: 2.80, inverted: true }, // $
    costPerLead:  { good: 25, average: 55, inverted: true },  // $
    roas:         { good: 4.0, average: 2.0 },            // x multiplier
};

// --- Google Ads Benchmarks (Search campaigns tend to have higher CTR but also higher CPC) ---
const GOOGLE_BENCHMARKS: Record<string, Thresholds> = {
    ctr:          { good: 4.0, average: 2.5 },            // % — Google Search avg higher
    cpm:          { good: 30, average: 55, inverted: true },
    cpc:          { good: 3.00, average: 5.50, inverted: true },
    costPerLead:  { good: 40, average: 80, inverted: true },
    roas:         { good: 3.5, average: 1.8 },
};

const GRADE_CONFIG: Record<BenchmarkGrade, { label: string; color: string }> = {
    good:    { label: 'Above Avg', color: '#22c55e' },
    average: { label: 'Average',   color: '#f59e0b' },
    poor:    { label: 'Below Avg', color: '#ef4444' },
};

/**
 * Grade a single metric against industry benchmarks.
 */
export function gradeMetric(
    metric: string,
    value: number | null | undefined,
    platform: 'meta' | 'google',
): MetricGrade | null {
    if (value === null || value === undefined || value === 0) return null;

    const benchmarks = platform === 'meta' ? META_BENCHMARKS : GOOGLE_BENCHMARKS;
    const thresholds = benchmarks[metric];
    if (!thresholds) return null;

    let grade: BenchmarkGrade;
    if (thresholds.inverted) {
        // Lower is better (costs)
        if (value <= thresholds.good) grade = 'good';
        else if (value <= thresholds.average) grade = 'average';
        else grade = 'poor';
    } else {
        // Higher is better (CTR, ROAS)
        if (value >= thresholds.good) grade = 'good';
        else if (value >= thresholds.average) grade = 'average';
        else grade = 'poor';
    }

    const cfg = GRADE_CONFIG[grade];
    return { grade, value, label: cfg.label, color: cfg.color };
}

/**
 * Grade all key metrics for a campaign.
 */
export function gradeAllMetrics(
    campaign: { ctr: number; cpm: number | null; cpc?: number | null; costPerResult: number | null; roas: number },
    platform: 'meta' | 'google',
): Record<string, MetricGrade | null> {
    return {
        ctr: gradeMetric('ctr', campaign.ctr, platform),
        cpm: gradeMetric('cpm', campaign.cpm, platform),
        costPerLead: gradeMetric('costPerLead', campaign.costPerResult, platform),
        roas: gradeMetric('roas', campaign.roas, platform),
    };
}

/**
 * Compute an overall campaign health score (A-F) from individual grades.
 * Weights: ROAS (30%), Cost/Lead (25%), CTR (25%), CPM (20%)
 */
export function overallGrade(grades: Record<string, MetricGrade | null>): { letter: string; color: string } {
    const weights: Record<string, number> = { roas: 30, costPerLead: 25, ctr: 25, cpm: 20 };
    const scores: Record<BenchmarkGrade, number> = { good: 100, average: 60, poor: 20 };

    let totalWeight = 0;
    let weightedScore = 0;

    for (const [metric, grade] of Object.entries(grades)) {
        if (!grade || !weights[metric]) continue;
        weightedScore += scores[grade.grade] * weights[metric];
        totalWeight += weights[metric];
    }

    if (totalWeight === 0) return { letter: '—', color: 'var(--text-muted)' };

    const score = weightedScore / totalWeight;

    if (score >= 85) return { letter: 'A', color: '#22c55e' };
    if (score >= 70) return { letter: 'B', color: '#86efac' };
    if (score >= 55) return { letter: 'C', color: '#f59e0b' };
    if (score >= 40) return { letter: 'D', color: '#fb923c' };
    return { letter: 'F', color: '#ef4444' };
}

/**
 * Get the benchmark thresholds for display (e.g., tooltips).
 */
export function getBenchmarkInfo(metric: string, platform: 'meta' | 'google'): {
    good: number; average: number; inverted: boolean; unit: string;
} | null {
    const benchmarks = platform === 'meta' ? META_BENCHMARKS : GOOGLE_BENCHMARKS;
    const t = benchmarks[metric];
    if (!t) return null;

    const units: Record<string, string> = { ctr: '%', cpm: '$', cpc: '$', costPerLead: '$', roas: 'x' };
    return { good: t.good, average: t.average, inverted: !!t.inverted, unit: units[metric] || '' };
}
