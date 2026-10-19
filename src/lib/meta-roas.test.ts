import { describe, it, expect } from 'vitest';
import { summarizeMatchedRevenue, isWithinLeadRetention } from './meta-roas';

describe('summarizeMatchedRevenue', () => {
    const leads = [
        // new patient: first purchase on/after the lead
        { email: 'a@x.com', revenue: 5199, leadDate: '2026-09-25', firstSaleDate: '2026-09-28' },
        // already a patient before the lead
        { email: 'b@x.com', revenue: 1000, leadDate: '2026-09-25', firstSaleDate: '2025-01-10' },
        // two leads from one person, revenue already split per lead
        { email: 'c@x.com', revenue: 300, leadDate: '2026-10-01', firstSaleDate: '2026-10-02' },
        { email: 'c@x.com', revenue: 300, leadDate: '2026-10-03', firstSaleDate: '2026-10-02' },
        // client record but no purchase in window
        { email: 'd@x.com', revenue: 0, leadDate: '2026-10-01', firstSaleDate: null },
    ];

    it('counts only leads with a purchase as matched', () => {
        expect(summarizeMatchedRevenue(leads).purchasingLeads).toBe(4);
    });

    it('splits revenue from people who were already patients before their lead', () => {
        const s = summarizeMatchedRevenue(leads);
        expect(s.totalRevenue).toBe(6799);
        // c's second lead (10/03) comes after c's first purchase (10/02): already a patient by then
        expect(s.priorPatientRevenue).toBe(1300);
        expect(s.newPatientRevenue).toBe(5499);
    });

    it('reports the single largest patient and their share of revenue', () => {
        const s = summarizeMatchedRevenue(leads);
        expect(s.topPatientRevenue).toBe(5199);
        expect(s.topPatientShare).toBeCloseTo(5199 / 6799, 5);
    });

    it('handles no purchases', () => {
        const s = summarizeMatchedRevenue([{ email: 'd@x.com', revenue: 0, leadDate: '2026-10-01', firstSaleDate: null }]);
        expect(s).toEqual({ purchasingLeads: 0, purchasingPatients: 0, totalRevenue: 0, priorPatientRevenue: 0, newPatientRevenue: 0, topPatientRevenue: 0, topPatientShare: 0 });
    });
    it('counts a buyer who submitted several forms as one paying patient', () => {
        const s = summarizeMatchedRevenue([
            { email: 'a@x.com', revenue: 100, leadDate: '2026-10-01', firstSaleDate: '2026-10-02' },
            { email: 'a@x.com', revenue: 100, leadDate: '2026-10-03', firstSaleDate: '2026-10-02' },
            { email: 'b@x.com', revenue: 50, leadDate: '2026-10-01', firstSaleDate: '2026-10-05' },
        ]);
        expect(s.purchasingLeads).toBe(3);
        expect(s.purchasingPatients).toBe(2);
    });
});

describe('isWithinLeadRetention', () => {
    const today = new Date('2026-10-19T19:00:00');

    it('is true for a window that starts within the last 90 days', () => {
        expect(isWithinLeadRetention('2026-09-20', today)).toBe(true);
        expect(isWithinLeadRetention('2026-07-22', today)).toBe(true); // 89 days back
    });

    it('is false once the window starts before Meta stops returning leads', () => {
        expect(isWithinLeadRetention('2026-07-01', today)).toBe(false);
        expect(isWithinLeadRetention('2026-07-20', today)).toBe(false); // 91 days back
    });
});
