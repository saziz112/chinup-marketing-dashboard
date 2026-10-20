/**
 * Prompts + JSON schemas for "why it worked" and Chin Up hook writing.
 */

import { formatPrice, type HookOffer } from './hooks';

export const HOOK_TYPES = ['question', 'bold_claim', 'price_reveal', 'before_after', 'myth_bust', 'pov', 'story', 'list', 'demo', 'other'] as const;
export const FORMATS = ['talking_head', 'voiceover_broll', 'treatment_demo', 'before_after', 'green_screen', 'text_on_screen', 'skit', 'other'] as const;

export interface VideoAnalysis {
    hookLine: string;
    hookType: (typeof HOOK_TYPES)[number];
    format: (typeof FORMATS)[number];
    structure: string[];
    whyItWorked: string;
    chinUpAngle: string;
}

export const ANALYSIS_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['hookLine', 'hookType', 'format', 'structure', 'whyItWorked', 'chinUpAngle'],
    properties: {
        hookLine: { type: 'string', description: 'The opening line or on-screen hook, quoted or closely paraphrased.' },
        hookType: { type: 'string', enum: [...HOOK_TYPES] },
        format: { type: 'string', enum: [...FORMATS] },
        structure: { type: 'array', items: { type: 'string' }, description: 'Beats in order, each a short phrase.' },
        whyItWorked: { type: 'string', description: '2-4 plain sentences.' },
        chinUpAngle: { type: 'string', description: 'How a med spa in Atlanta could reuse the idea, 1-2 sentences.' },
    },
};

export const ANALYSIS_SYSTEM = `You study short-form med spa videos and explain why one beat its account's usual views.
Be concrete: point at the hook words, the order of beats, and the format. Don't guess at things you can't see.
If there is no transcript, say your read is based on the caption only.`;

export function buildAnalysisPrompt(v: {
    platform: string; accountHandle: string; caption: string; transcript: string | null;
    views: number | null; accountMedian: number | null; score: number | null; durationSec: number | null;
}): string {
    return [
        `Platform: ${v.platform}. Account: @${v.accountHandle}.`,
        `Views: ${v.views ?? 'unknown'}; account median: ${v.accountMedian ?? 'unknown'}; outlier score: ${v.score ?? 'unknown'}x.`,
        `Length: ${v.durationSec ?? 'unknown'} seconds.`,
        `Caption:\n${v.caption || '(none)'}`,
        v.transcript ? `Transcript:\n${v.transcript}` : 'Transcript: not available. Base your read on the caption and say so in whyItWorked.',
    ].join('\n\n');
}

export interface HookDraft {
    hooks: string[];
    script: { hook: string; beats: string[]; cta: string };
}

export const HOOK_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['hooks', 'script'],
    properties: {
        hooks: { type: 'array', items: { type: 'string' } },
        script: {
            type: 'object',
            additionalProperties: false,
            required: ['hook', 'beats', 'cta'],
            properties: {
                hook: { type: 'string' },
                beats: { type: 'array', items: { type: 'string' } },
                cta: { type: 'string' },
            },
        },
    },
};

export const HOOK_SYSTEM = `You write short-form video hooks for Chin Up Aesthetics, a med spa in Atlanta (Smyrna/Vinings and Decatur).
Rule: clear over clever. Every hook must say the treatment by name AND the exact price, written with a $ sign exactly as given.
Write at a 5th-grade level: short, common words, one idea per line. No medical claims, no "guaranteed", no made-up numbers or discounts.
Never use any price other than the one given.`;

export function buildHookPrompt(offer: HookOffer & { details?: string }, count: number, inspiration?: { hookLine: string; hookType: string; structure: string[]; whyItWorked: string }): string {
    const price = formatPrice(offer.price);
    const lines = [
        `Treatment: ${offer.treatment}`,
        `Price: ${price} (write it exactly as "${price}")`,
        offer.details ? `What they get: ${offer.details}` : '',
        `Write ${count} hooks, each under 15 words, each containing "${offer.treatment}" and "${price}".`,
        'Then write one 20-30 second script: the hook, 3-5 short beats, and a call to action to book at Chin Up.',
    ];
    if (inspiration) {
        lines.push(
            `Borrow the shape of this video that beat its account's usual views (don't copy its words):`,
            `Hook: "${inspiration.hookLine}" (${inspiration.hookType}). Beats: ${inspiration.structure.join(' → ')}. Why it worked: ${inspiration.whyItWorked}`,
        );
    }
    return lines.filter(Boolean).join('\n');
}
