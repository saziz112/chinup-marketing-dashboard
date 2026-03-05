/**
 * GoHighLevel Strategic Intelligence Engine
 * Analyzes pipeline data for CEO-level insights, recovery projections,
 * reactivation campaign suggestions, funnel analysis, and funnel recommendations.
 */

import { type FullPipelineData, type StaleLead, type LocationKey, getStaleLeads, getFullPipelineData } from '@/lib/integrations/gohighlevel';

// --- Types ---

export interface StrategyResponse {
    insights: string[];
    recoveryPotential: {
        totalStaleLeads: number;
        estimatedRevenue: number;
        highPriority: number;
        reactivationRate: number;
    };
    staleBySeverity: {
        atRisk: StaleGroup;
        stale: StaleGroup;
        dormant: StaleGroup;
    };
    locationComparison: LocationComparisonRow[];
    funnelAnalysis: FunnelAnalysis[];
}

interface StaleGroup {
    count: number;
    value: number;
    topStages: { name: string; count: number }[];
    suggestion: string;
}

interface LocationComparisonRow {
    location: string;
    locationName: string;
    totalOpen: number;
    wonCount: number;
    lostCount: number;
    conversionRate: number;
    totalValue: number;
    staleCount: number;
}

export interface FunnelStageAnalysis {
    name: string;
    count: number;
    value: number;
    percentOfTotal: number;
    dropOffFromPrevious: number;
    dropOffPercent: number;
    recommendation: string;
}

export interface FunnelAnalysis {
    locationName: string;
    locationKey: string;
    pipelineName: string;
    pipelineId: string;
    totalLeads: number;
    stages: FunnelStageAnalysis[];
    biggestLeak: { from: string; to: string; lost: number; percent: number } | null;
    overallRecommendation: string;
    newFunnelSuggestions: string[];
}

// --- Stage Recommendation Engine ---

const STAGE_RECOMMENDATIONS: Record<string, string> = {
    'new lead': 'Speed-to-lead is critical — respond within 5 minutes. Automate an instant SMS + email upon lead capture.',
    'called 1x': 'One call isn\'t enough. Set up an automated 3-call sequence with voicemail drops at 5 min, 30 min, and 2 hours.',
    'called 2x': 'This is where most leads stall. Add a "break the pattern" touchpoint — try a personalized video message or text with a compelling offer.',
    'engaged lead': 'They\'re interested but haven\'t committed. Send social proof (reviews, before/afters) and create urgency with a limited-time consultation offer.',
    'stale lead': 'These need a completely different approach. Run a re-engagement campaign with a strong incentive (20% off, free add-on service).',
    'appt scheduled': 'Reduce no-shows with confirmation texts (24h and 2h before). Include parking directions and what to expect.',
    'appt rescheduled': 'High risk of falling off. Send a "we saved your spot" text with the new time and a cancellation-is-easy reassurance.',
    'no shows': 'Immediate outreach within 30 minutes: "We missed you today! Would you like to reschedule? We have openings tomorrow." No judgment, just helpfulness.',
    'cancelled': 'Understand why — send a brief survey. Then add to a 30-day win-back drip: "Still thinking about [treatment]? Here\'s what our clients say..."',
    'treated': 'Post-treatment follow-up: satisfaction check at 24h, request a Google review at 72h, rebook offer at 2 weeks.',
    'cold leads': 'Warm them up with educational content — treatment explainers, FAQ videos, client testimonials delivered over 2 weeks.',
    'warm leads': 'They\'re engaged — push for the booking. "We have a cancellation this week, would you like this premium slot?"',
    'trial purchased': 'Convert trial to full program. Follow up after their first session with results expectations and a package upgrade offer.',
    'appt booked': 'Same as Appt Scheduled — focus on reducing no-shows with multiple reminder touchpoints.',
};

function getStageRecommendation(stageName: string, count: number, totalLeads: number): string {
    const key = stageName.toLowerCase().replace(/[^a-z\s]/g, '').trim();

    // Check for exact or partial match in recommendations
    for (const [pattern, rec] of Object.entries(STAGE_RECOMMENDATIONS)) {
        if (key.includes(pattern) || pattern.includes(key)) {
            const pct = totalLeads > 0 ? Math.round((count / totalLeads) * 100) : 0;
            if (pct > 30) {
                return `${pct}% of your pipeline is stuck here. ${rec}`;
            }
            return rec;
        }
    }

    // Generic recommendation based on position
    const pct = totalLeads > 0 ? Math.round((count / totalLeads) * 100) : 0;
    if (pct > 40) return `${pct}% of leads are in this stage — this is a major bottleneck. Review your follow-up cadence and consider adding automation.`;
    if (pct > 20) return `Significant volume here. Ensure consistent follow-up within 24 hours of entering this stage.`;
    if (count === 0) return 'No leads in this stage — either the pipeline is flowing well past this point, or leads are skipping it entirely.';
    return 'Monitor this stage and ensure leads aren\'t sitting idle for more than 48 hours.';
}

// --- Funnel Analysis ---

function computeFunnelAnalysis(pipelineData: FullPipelineData): FunnelAnalysis[] {
    const analyses: FunnelAnalysis[] = [];

    for (const loc of pipelineData.locations) {
        for (const pipeline of loc.pipelines) {
            const activeStages = pipeline.stages.filter(s => s.count > 0);
            const totalLeads = pipeline.totalOpen;

            if (totalLeads === 0) continue;

            const stageAnalysis: FunnelStageAnalysis[] = pipeline.stages.map((stage, idx) => {
                const prevCount = idx > 0 ? pipeline.stages[idx - 1].count : totalLeads;
                const dropOff = idx > 0 ? Math.max(0, prevCount - stage.count) : 0;
                const dropOffPercent = idx > 0 && prevCount > 0 ? Math.round((dropOff / prevCount) * 100) : 0;
                const percentOfTotal = totalLeads > 0 ? Math.round((stage.count / totalLeads) * 100) : 0;

                return {
                    name: stage.name,
                    count: stage.count,
                    value: stage.value,
                    percentOfTotal,
                    dropOffFromPrevious: dropOff,
                    dropOffPercent,
                    recommendation: getStageRecommendation(stage.name, stage.count, totalLeads),
                };
            });

            // Find biggest leak (largest drop-off between adjacent stages with leads)
            let biggestLeak: FunnelAnalysis['biggestLeak'] = null;
            for (let i = 0; i < activeStages.length - 1; i++) {
                const from = activeStages[i];
                const to = activeStages[i + 1];
                if (from.count > to.count) {
                    const lost = from.count - to.count;
                    const pct = Math.round((lost / from.count) * 100);
                    if (!biggestLeak || lost > biggestLeak.lost) {
                        biggestLeak = { from: from.name, to: to.name, lost, percent: pct };
                    }
                }
            }

            // Overall recommendation
            const overallRecommendation = generateOverallRecommendation(pipeline, activeStages, loc.locationName);

            // New funnel suggestions
            const newFunnelSuggestions = generateNewFunnelSuggestions(pipeline, loc);

            analyses.push({
                locationName: loc.locationName,
                locationKey: loc.location,
                pipelineName: pipeline.name,
                pipelineId: pipeline.id,
                totalLeads,
                stages: stageAnalysis,
                biggestLeak,
                overallRecommendation,
                newFunnelSuggestions,
            });
        }
    }

    return analyses;
}

function generateOverallRecommendation(
    pipeline: FullPipelineData['locations'][0]['pipelines'][0],
    activeStages: { name: string; count: number }[],
    locationName: string,
): string {
    const total = pipeline.totalOpen;
    const wonRate = (pipeline.wonCount + pipeline.lostCount) > 0
        ? Math.round((pipeline.wonCount / (pipeline.wonCount + pipeline.lostCount)) * 100)
        : 0;

    // Find where most leads pile up
    const biggest = activeStages.reduce((max, s) => s.count > max.count ? s : max, activeStages[0]);
    const biggestPct = total > 0 ? Math.round((biggest.count / total) * 100) : 0;

    if (wonRate < 15) {
        return `${locationName}'s "${pipeline.name}" has a ${wonRate}% conversion rate — below the 20% benchmark for med spas. ` +
            `Focus on speed-to-lead (respond in under 5 minutes) and add automated nurture sequences for leads that don't answer the first call.`;
    }

    if (biggestPct > 40) {
        return `${biggestPct}% of "${pipeline.name}" leads at ${locationName} are stuck in "${biggest.name}". ` +
            `This is the #1 place to focus. Consider assigning a dedicated team member to work this stage daily, ` +
            `or build an automated drip sequence that moves leads forward.`;
    }

    if (wonRate > 30) {
        return `${locationName}'s "${pipeline.name}" is performing well with a ${wonRate}% conversion rate. ` +
            `Maintain current processes and look for ways to increase top-of-funnel volume to scale revenue.`;
    }

    return `${locationName}'s "${pipeline.name}" has ${total} active leads with a ${wonRate}% close rate. ` +
        `Review each stage weekly and ensure no lead sits idle for more than 48 hours without a touchpoint.`;
}

function generateNewFunnelSuggestions(
    pipeline: FullPipelineData['locations'][0]['pipelines'][0],
    loc: FullPipelineData['locations'][0],
): string[] {
    const suggestions: string[] = [];
    const pipelineNames = loc.pipelines.map(p => p.name.toLowerCase());
    const hasOffersPipeline = pipelineNames.some(n => n.includes('offer'));
    const hasLeadsPipeline = pipelineNames.some(n => n.includes('lead'));
    const hasRetentionPipeline = pipelineNames.some(n => n.includes('retention') || n.includes('rebooking') || n.includes('existing'));

    // Check for "No Shows" stage with significant count
    const noShowStage = pipeline.stages.find(s => s.name.toLowerCase().includes('no show'));
    if (noShowStage && noShowStage.count > 5) {
        suggestions.push(
            `Create a "No-Show Recovery" pipeline with ${noShowStage.count} leads. ` +
            `Stage 1: Immediate "we missed you" text (30 min). Stage 2: Reschedule offer (24h). Stage 3: Incentive offer (72h). Stage 4: Win-back (7d).`
        );
    }

    // Suggest retention pipeline
    if (!hasRetentionPipeline && pipeline.wonCount > 20) {
        suggestions.push(
            `Create a "Patient Retention" pipeline for ${pipeline.wonCount} treated clients. ` +
            `Stages: Post-Treatment Check-in → Review Request → Rebooking Offer → Membership Upsell → Referral Ask. ` +
            `This turns one-time patients into recurring revenue.`
        );
    }

    // Suggest offers pipeline
    if (!hasOffersPipeline && hasLeadsPipeline) {
        suggestions.push(
            `Consider building an "Offers & Promotions" pipeline. When you run a seasonal special or flash sale, ` +
            `move qualified leads into this funnel with stages: Cold → Interested → Offer Sent → Booked → Purchased. ` +
            `This keeps your leads pipeline clean and gives you clear offer conversion tracking.`
        );
    }

    // Suggest referral pipeline
    if (!pipelineNames.some(n => n.includes('referral'))) {
        suggestions.push(
            `Build a "Referral Program" pipeline. Stage 1: Ask for referral (post-treatment). ` +
            `Stage 2: Referral received. Stage 3: Referral booked. Stage 4: Both rewarded. ` +
            `Your best leads come from happy patients — systematize it.`
        );
    }

    // If location has ad-specific pipelines, suggest consolidation
    const adPipelines = loc.pipelines.filter(p => p.name.toLowerCase().includes('ad'));
    if (adPipelines.length > 2) {
        suggestions.push(
            `You have ${adPipelines.length} ad-specific pipelines (${adPipelines.map(p => p.name).join(', ')}). ` +
            `Consider consolidating into a single "Ads Pipeline" with tags for each treatment type. ` +
            `This makes it easier to compare ad performance across treatments and reduces pipeline management overhead.`
        );
    }

    return suggestions;
}

// --- Insight Functions ---

function computeInsights(pipelineData: FullPipelineData, staleLeads: StaleLead[]): string[] {
    const insights: string[] = [];
    const { totals, locations } = pipelineData;

    insights.push(
        `You have ${totals.totalOpen.toLocaleString()} open opportunities across ${locations.length} location${locations.length > 1 ? 's' : ''}, ` +
        `with a ${totals.conversionRate}% conversion rate (${totals.totalWon.toLocaleString()} won, ${totals.totalLost.toLocaleString()} lost).`
    );

    if (totals.totalValue > 0) {
        insights.push(
            `Total open pipeline value is ${formatCurrency(totals.totalValue)}. ` +
            `Focus follow-ups on high-value opportunities to maximize revenue.`
        );
    }

    if (staleLeads.length > 0) {
        const dormant = staleLeads.filter(l => l.staleness === 'dormant');
        const atRisk = staleLeads.filter(l => l.staleness === 'at-risk');
        const totalValue = staleLeads.reduce((s, l) => s + l.opportunity.monetaryValue, 0);
        const estimated = Math.round(totalValue * 0.15);

        insights.push(
            `${staleLeads.length} leads are inactive for 14+ days (${atRisk.length} at-risk, ${dormant.length} dormant). ` +
            `Re-engaging these could recover an estimated ${formatCurrency(estimated)} in revenue at a 15% reactivation rate.`
        );
    }

    if (locations.length > 1) {
        const bestLoc = locations.reduce((best, loc) => {
            const locWon = loc.pipelines.reduce((s, p) => s + p.wonCount, 0);
            const locLost = loc.pipelines.reduce((s, p) => s + p.lostCount, 0);
            const bestWon = best.pipelines.reduce((s, p) => s + p.wonCount, 0);
            const bestLost = best.pipelines.reduce((s, p) => s + p.lostCount, 0);
            const locRate = (locWon + locLost > 0) ? locWon / (locWon + locLost) : 0;
            const bestRate = (bestWon + bestLost > 0) ? bestWon / (bestWon + bestLost) : 0;
            return locRate > bestRate ? loc : best;
        });

        const bestWon = bestLoc.pipelines.reduce((s, p) => s + p.wonCount, 0);
        const bestLost = bestLoc.pipelines.reduce((s, p) => s + p.lostCount, 0);
        const bestRate = (bestWon + bestLost > 0) ? Math.round((bestWon / (bestWon + bestLost)) * 100) : 0;

        insights.push(
            `${bestLoc.locationName} has the highest conversion rate at ${bestRate}%. ` +
            `Consider replicating their follow-up process across other locations.`
        );
    }

    const sources = pipelineData.sourceBreakdown;
    if (sources.length > 0) {
        const topSource = sources[0];
        const pct = totals.totalOpen > 0 ? Math.round((topSource.count / (totals.totalOpen + totals.totalWon + totals.totalLost)) * 100) : 0;
        insights.push(
            `"${topSource.source}" is your top lead source (${topSource.count} leads, ${pct}% of total). ` +
            (topSource.source.toLowerCase().includes('fb') || topSource.source.toLowerCase().includes('facebook')
                ? `Facebook ads are driving the majority of your pipeline — ensure ad targeting stays optimized.`
                : `Continue investing in this channel.`)
        );
    }

    const allStages = locations.flatMap(l => l.pipelines.flatMap(p => p.stages));
    const stageAgg = new Map<string, number>();
    for (const s of allStages) {
        stageAgg.set(s.name, (stageAgg.get(s.name) || 0) + s.count);
    }
    const biggestStage = Array.from(stageAgg.entries()).sort((a, b) => b[1] - a[1])[0];
    if (biggestStage && biggestStage[1] > 10) {
        insights.push(
            `Your biggest bottleneck is "${biggestStage[0]}" with ${biggestStage[1]} leads stuck there. ` +
            `Consider automating follow-ups or assigning staff to move these leads forward.`
        );
    }

    return insights;
}

function computeStaleGroups(staleLeads: StaleLead[], isAdmin: boolean): {
    atRisk: StaleGroup;
    stale: StaleGroup;
    dormant: StaleGroup;
} {
    const groups = {
        atRisk: { leads: [] as StaleLead[] },
        stale: { leads: [] as StaleLead[] },
        dormant: { leads: [] as StaleLead[] },
    };

    for (const lead of staleLeads) {
        if (lead.staleness === 'at-risk') groups.atRisk.leads.push(lead);
        else if (lead.staleness === 'stale') groups.stale.leads.push(lead);
        else groups.dormant.leads.push(lead);
    }

    function buildGroup(leads: StaleLead[], suggestion: string): StaleGroup {
        const stageCount = new Map<string, number>();
        let totalValue = 0;
        for (const l of leads) {
            stageCount.set(l.stageName, (stageCount.get(l.stageName) || 0) + 1);
            totalValue += l.opportunity.monetaryValue;
        }
        const topStages = Array.from(stageCount.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([name, count]) => ({ name, count }));

        return {
            count: leads.length,
            value: isAdmin ? totalValue : 0,
            topStages,
            suggestion,
        };
    }

    return {
        atRisk: buildGroup(groups.atRisk.leads,
            `Send a quick SMS: "Hi [Name], we wanted to follow up on your consultation inquiry. We have availability this week — would you like to book? Reply YES or call us at (XXX) XXX-XXXX."`
        ),
        stale: buildGroup(groups.stale.leads,
            `Launch a 3-part email sequence: (1) Reminder of their interest, (2) Value proposition with before/after results, (3) Limited-time 15% off offer with urgency.`
        ),
        dormant: buildGroup(groups.dormant.leads,
            `Run a win-back campaign: "We miss you! Here's an exclusive 20% off your first treatment. This offer expires in 48 hours." SMS + email combo for max reach.`
        ),
    };
}

function computeLocationComparison(
    pipelineData: FullPipelineData,
    staleLeads: StaleLead[],
): LocationComparisonRow[] {
    return pipelineData.locations.map(loc => {
        const totalOpen = loc.pipelines.reduce((s, p) => s + p.totalOpen, 0);
        const wonCount = loc.pipelines.reduce((s, p) => s + p.wonCount, 0);
        const lostCount = loc.pipelines.reduce((s, p) => s + p.lostCount, 0);
        const totalValue = loc.pipelines.reduce((s, p) => s + p.totalValue, 0);
        const total = wonCount + lostCount;
        const conversionRate = total > 0 ? Math.round((wonCount / total) * 100) : 0;
        const staleCount = staleLeads.filter(l => l.locationKey === loc.location).length;

        return {
            location: loc.location,
            locationName: loc.locationName,
            totalOpen,
            wonCount,
            lostCount,
            conversionRate,
            totalValue,
            staleCount,
        };
    });
}

function formatCurrency(val: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);
}

// --- Main Export ---

export async function getStrategyAnalysis(options?: {
    locationFilter?: LocationKey;
    isAdmin?: boolean;
}): Promise<StrategyResponse> {
    const [pipelineData, staleLeads] = await Promise.all([
        getFullPipelineData({ locationFilter: options?.locationFilter }),
        getStaleLeads(options?.locationFilter),
    ]);

    const isAdmin = options?.isAdmin ?? false;
    const insights = computeInsights(pipelineData, staleLeads);
    const staleBySeverity = computeStaleGroups(staleLeads, isAdmin);
    const locationComparison = computeLocationComparison(pipelineData, staleLeads);
    const funnelAnalysis = computeFunnelAnalysis(pipelineData);

    // Recovery potential
    const totalStaleValue = staleLeads.reduce((s, l) => s + l.opportunity.monetaryValue, 0);
    const reactivationRate = 0.15;
    const highPriority = staleLeads.filter(l => l.staleness === 'at-risk' && l.opportunity.monetaryValue > 0).length;

    return {
        insights,
        recoveryPotential: {
            totalStaleLeads: staleLeads.length,
            estimatedRevenue: isAdmin ? Math.round(totalStaleValue * reactivationRate) : 0,
            highPriority,
            reactivationRate,
        },
        staleBySeverity,
        locationComparison: isAdmin ? locationComparison : locationComparison.map(l => ({ ...l, totalValue: 0 })),
        funnelAnalysis: isAdmin
            ? funnelAnalysis
            : funnelAnalysis.map(f => ({
                ...f,
                stages: f.stages.map(s => ({ ...s, value: 0 })),
            })),
    };
}
