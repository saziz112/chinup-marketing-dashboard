/** Revenue summary for Meta leads matched to patients by email. */

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
