import { describe, it, expect } from 'vitest';
import { summarizeCampaigns } from './ads-benchmarks';

const c = (o: Partial<{ status: string; impressions: number; clicks: number; spend: number | null; results: number; roas: number }>) => ({
    status: 'ACTIVE', impressions: 1000, clicks: 20, spend: 100, results: 2, roas: 0, ...o,
});

describe('summarizeCampaigns', () => {
    it('weights ROAS by spend instead of averaging campaigns equally', () => {
        // $900 at 1x and $100 at 10x: an unweighted mean says 5.5x, the money says 1.9x.
        const s = summarizeCampaigns([c({ spend: 900, roas: 1 }), c({ spend: 100, roas: 10 })]);
        expect(s.roas).toBeCloseTo(1.9, 5);
    });

    it('uses every campaign that delivered, paused ones included, like the KPI totals', () => {
        const s = summarizeCampaigns([
            c({ impressions: 1000, clicks: 10 }),
            c({ status: 'PAUSED', impressions: 1000, clicks: 50 }),
            c({ status: 'PAUSED', impressions: 0, clicks: 0, spend: 0 }),
        ]);
        expect(s.campaignCount).toBe(2);
        expect(s.ctr).toBeCloseTo(3, 5);
    });

    it('reports ROAS as untracked (null) when no campaign has any conversion value', () => {
        const s = summarizeCampaigns([c({ roas: 0 }), c({ roas: 0 })]);
        expect(s.roas).toBeNull();
    });
});
