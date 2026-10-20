import { describe, it, expect } from 'vitest';
import { buildHookPrompt, buildAnalysisPrompt } from './prompts';

describe('buildHookPrompt', () => {
    it('pins the exact treatment and formatted price', () => {
        const p = buildHookPrompt({ treatment: 'Restylane', price: 2113.2 }, 5);
        expect(p).toContain('Treatment: Restylane');
        expect(p).toContain('"$2,113.20"');
        expect(p).toContain('Write 5 hooks');
    });

    it('adds the source video shape when given', () => {
        const p = buildHookPrompt({ treatment: 'Botox', price: 199 }, 3, {
            hookLine: 'What $650 of Dysport gets you', hookType: 'price_reveal', structure: ['ask', 'reveal'], whyItWorked: 'Answers a money question fast.',
        });
        expect(p).toContain('ask → reveal');
        expect(p).toContain('$199');
    });
});

describe('buildAnalysisPrompt', () => {
    it('says when there is no transcript', () => {
        const p = buildAnalysisPrompt({ platform: 'tiktok', accountHandle: 'x', caption: 'hi', transcript: null, views: 10, accountMedian: 2, score: 5, durationSec: 20 });
        expect(p).toContain('Transcript: not available');
        expect(p).toContain('outlier score: 5x');
    });
});
