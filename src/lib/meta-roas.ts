/** Revenue summary for Meta leads matched to patients by email. */

import { format, subDays } from 'date-fns';

export interface MatchedLead {
    email: string;
    revenue: number;              // in-window revenue, already split across that person's leads
    leadDate: string;             // YYYY-MM-DD
    firstSaleDate: string | null; // earliest sale ever, YYYY-MM-DD
}

export interface MatchedRevenueSummary {
    purchasingLeads: number;
    purchasingPatients: number;   // distinct people; one buyer can submit several forms
    totalRevenue: number;
    priorPatientRevenue: number;  // from people who had already bought before this lead
    newPatientRevenue: number;
    topPatientRevenue: number;
    topPatientShare: number;      // 0..1 of totalRevenue
}

export function summarizeMatchedRevenue(leads: MatchedLead[]): MatchedRevenueSummary {
    const purchasing = leads.filter(l => l.revenue > 0);
    const byPerson = new Map<string, number>();
    let totalRevenue = 0;
    let priorPatientRevenue = 0;
    for (const l of purchasing) {
        totalRevenue += l.revenue;
        if (l.firstSaleDate && l.firstSaleDate < l.leadDate) priorPatientRevenue += l.revenue;
        byPerson.set(l.email, (byPerson.get(l.email) || 0) + l.revenue);
    }
    const topPatientRevenue = Math.max(0, ...byPerson.values());
    return {
        purchasingLeads: purchasing.length,
        purchasingPatients: byPerson.size,
        totalRevenue,
        priorPatientRevenue,
        newPatientRevenue: totalRevenue - priorPatientRevenue,
        topPatientRevenue,
        topPatientShare: totalRevenue > 0 ? topPatientRevenue / totalRevenue : 0,
    };
}

/**
 * Meta only returns lead form submissions from the last 90 days, so for an
 * older window most leads are missing and the email match reads as ~0 ROAS.
 * One day of margin keeps a window starting exactly 90 days back out, since
 * its earliest leads expire during the day.
 */
export const LEAD_RETENTION_DAYS = 90;

export function isWithinLeadRetention(since: string, today: Date = new Date()): boolean {
    return since >= format(subDays(today, LEAD_RETENTION_DAYS - 1), 'yyyy-MM-dd');
}
