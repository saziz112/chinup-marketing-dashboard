/**
 * Kie.ai API Client — Nano Banana 2 Image Generation
 * Creates AI images for social media content.
 * Async workflow: createTask → poll recordInfo until complete.
 */

import { trackCall } from '@/lib/api-usage-tracker';

const KIE_API_BASE = 'https://api.kie.ai/api/v1/jobs';

// --- Types ---

export type CreativeModel = 'nano-banana-2' | 'nano-banana-pro';
export type CreativeStyle = 'educational' | 'before-after' | 'treatment' | 'product-spotlight' | 'lifestyle' | 'carousel-graphic' | 'reel-thumbnail';
export type AspectRatio = '1:1' | '4:5' | '9:16' | '3:4' | '4:3' | '16:9';
export type Resolution = '1024' | '2048' | '4096';

export const MODEL_INFO: Record<CreativeModel, { label: string; description: string; pricing: Record<Resolution, string>; maxRefImages: number }> = {
    'nano-banana-pro': {
        label: 'Nano Banana Pro',
        description: 'Gemini 3 Pro — best style matching & quality',
        pricing: { '1024': '$0.09', '2048': '$0.09', '4096': '$0.12' },
        maxRefImages: 8,
    },
    'nano-banana-2': {
        label: 'Nano Banana 2',
        description: 'Gemini 3.1 Flash — fastest & cheapest',
        pricing: { '1024': '$0.04', '2048': '$0.06', '4096': '$0.09' },
        maxRefImages: 14,
    },
};

export interface GenerateRequest {
    prompt: string;
    model?: CreativeModel;
    style: CreativeStyle;
    aspectRatio: AspectRatio;
    resolution: Resolution;
    referenceImageUrl?: string;       // legacy single URL
    referenceImageUrls?: string[];    // multiple reference images (up to 3)
    brandContext?: string;            // brand prompt enhancement from IG analysis
    includeBrandLogo?: boolean;       // subtly include brand logo in the image
}

export interface GenerateResult {
    taskId: string;
    enhancedPrompt: string;
}

export interface TaskStatus {
    status: 'pending' | 'processing' | 'success' | 'failed';
    imageUrl?: string;
    costTimeMs?: number;
    failMsg?: string;
}

// --- Config ---

function getEnv(key: string): string {
    const val = process.env[key];
    if (!val) throw new Error(`Missing env var: ${key}`);
    return val;
}

export function isKieAiConfigured(): boolean {
    return !!process.env.KIE_AI_API_KEY;
}

// ─── Chin Up! Brand Guidelines (from Chin_Up_Aesthetics_Brand_Guidelines_AI.md) ───

const BRAND_BASE = {
    // Always-on color rules
    colorAnchors: 'Color palette: champagne gold (#D8B41D) accents, rich black (#0A0A0A) or clean cream (#FDF8E0)/ivory (#FAF9F5) backgrounds, pure white text on dark, black text on light. Gold as accent only, never dominant background. No neon, bright blues, greens, or saturated colors outside palette.',
    // Core visual identity
    visualIdentity: 'Luxury medical spa aesthetic blending clinical credibility with editorial warmth. Modern minimalist interiors, warm ambient lighting, gold hardware accents, cream walls. Not sterile or hospital-like, not overly glamorous.',
    // Subject guidelines
    subjects: 'Diverse women (Black, Latina, Asian, White), ages 25-55, natural beauty with healthy glowing skin, confident and approachable expressions. Staff in black scrubs or white lab coats. No overly retouched or doll-like subjects.',
    // Composition rules
    composition: 'Rule of thirds, shallow depth of field, eye-level or slightly above camera angle. Professional editorial quality.',
    // Hard restrictions
    restrictions: 'Do not include any text, logos, watermarks, brand names, or signage. No harsh fluorescent lighting. No busy or distracting backgrounds. No stock photography look. No cartoonish subjects.',
};

/** Warm/light mood anchor — used for lifestyle, educational, product content */
const MOOD_WARM = 'warm golden lighting, cream and gold color palette, modern minimalist environment, soft natural tones, high-end editorial style, clean and sophisticated';

/** Dark/bold mood anchor — used for carousel graphics, reel thumbnails, dramatic content */
const MOOD_DARK = 'dramatic warm lighting, black and gold color palette, modern minimalist dark background, rich warm tones, high-end editorial style, elegant and sophisticated';

/** Clinical/educational mood anchor — used for before/after, treatment content */
const MOOD_CLINICAL = 'clean clinical lighting, neutral cream background, medical-grade aesthetic, authoritative and precise, warm undertones, professional healthcare photography, modern treatment environment';

// Content-type templates from brand guidelines Section 5
const STYLE_PREFIXES: Record<CreativeStyle, string> = {
    'educational': `Professional female nurse practitioner or aesthetician, confident expert demeanor, direct eye contact with camera, modern luxury medical spa office background, warm ambient lighting, clean minimalist background with cream walls and gold accent details, ${MOOD_WARM}, authoritative and approachable presence`,
    'before-after': `Clean split-screen portrait composition, professional studio lighting, neutral cream background, clinical documentation photography, consistent lighting on both sides, medical spa aesthetic, warm skin tones, ${MOOD_CLINICAL}`,
    'treatment': `Aesthetic treatment in progress, professional gloved hands, medical-grade skincare procedure, soft clinical lighting, modern treatment room, patient appears relaxed and comfortable, shallow depth of field, clinical precision with warm tones, ${MOOD_CLINICAL}`,
    'product-spotlight': `Medical-grade skincare product on minimalist surface, soft cream marble or black velvet background, warm golden side lighting, elegant luxury product photography, clean composition, single hero product, high-end beauty brand aesthetic, ${MOOD_WARM}`,
    'lifestyle': `Confident woman with radiant glowing skin, soft natural lighting, warm golden tones, elegant home or spa environment, self-care moment, aspirational but authentic, luxury wellness lifestyle photography, ${MOOD_WARM}`,
    'carousel-graphic': `Clean minimalist graphic design layout, rich black background, elegant gold accent lines, sophisticated and professional, luxury information card aesthetic, plenty of negative space, magazine-quality layout feel, ${MOOD_DARK}`,
    'reel-thumbnail': `Diverse woman with confident expression looking at camera, modern medical spa setting, soft warm lighting, black and gold color scheme, composition with negative space on one side for text overlay, luxury aesthetic clinic environment, editorial style photography, ${MOOD_DARK}`,
};

const ASPECT_RATIO_CONTEXT: Record<AspectRatio, string> = {
    '1:1': 'square composition',
    '4:5': 'vertical portrait composition',
    '9:16': 'tall vertical story composition',
    '3:4': 'classic portrait composition',
    '4:3': 'landscape composition',
    '16:9': 'wide cinematic landscape composition',
};

const RESOLUTION_MAP: Record<Resolution, { width: number; height: number }> = {
    '1024': { width: 1024, height: 1024 },
    '2048': { width: 2048, height: 2048 },
    '4096': { width: 4096, height: 4096 },
};

function getResolutionForAspect(resolution: Resolution, aspectRatio: AspectRatio): { width: number; height: number } {
    const base = RESOLUTION_MAP[resolution];
    const [w, h] = aspectRatio.split(':').map(Number);
    const ratio = w / h;

    if (ratio >= 1) {
        return { width: base.width, height: Math.round(base.width / ratio) };
    } else {
        return { width: Math.round(base.height * ratio), height: base.height };
    }
}

// --- Prompt Enhancement ---

export function enhancePrompt(userPrompt: string, style: CreativeStyle, aspectRatio: AspectRatio, brandContext?: string, _includeBrandLogo?: boolean): string {
    // Layer 1: Brand DNA (always on — color palette, visual identity, subject rules)
    const brandDna = `${BRAND_BASE.visualIdentity} ${BRAND_BASE.colorAnchors} ${BRAND_BASE.subjects}`;

    // Layer 2: Content-type template (from brand guidelines Section 5)
    const contentTemplate = STYLE_PREFIXES[style];

    // Layer 3: Composition + aspect ratio
    const arContext = ASPECT_RATIO_CONTEXT[aspectRatio];
    const compositionRules = BRAND_BASE.composition;

    // Layer 4: Supplementary IG-analyzed brand context (if available — adds nuance, doesn't override)
    const igContext = brandContext ? `Additional style reference: ${brandContext}` : '';

    // Layer 5: Quality + restrictions
    const quality = 'Shot on professional camera, natural imperfections, realistic skin texture with pores, authentic lighting, editorial quality';

    return `${brandDna}. ${contentTemplate}, ${arContext}. ${compositionRules}. ${userPrompt}. ${igContext} ${BRAND_BASE.restrictions}. ${quality}`.replace(/\s{2,}/g, ' ').trim();
}

// --- API Calls ---

const RESOLUTION_LABEL: Record<Resolution, string> = {
    '1024': '1K',
    '2048': '2K',
    '4096': '4K',
};

export async function createImageTask(req: GenerateRequest): Promise<GenerateResult> {
    const apiKey = getEnv('KIE_AI_API_KEY');
    const enhancedPrompt = enhancePrompt(req.prompt, req.style, req.aspectRatio, req.brandContext, req.includeBrandLogo);

    // Support both legacy single URL and new multi-URL array
    const refImages = req.referenceImageUrls?.length
        ? req.referenceImageUrls
        : req.referenceImageUrl ? [req.referenceImageUrl] : [];

    const input: Record<string, unknown> = {
        prompt: enhancedPrompt,
        aspect_ratio: req.aspectRatio,
        resolution: RESOLUTION_LABEL[req.resolution],
        output_format: 'png',
        google_search: false,
        image_input: refImages,
    };

    const body = {
        model: req.model || 'nano-banana-pro',
        input,
    };

    const res = await fetch(`${KIE_API_BASE}/createTask`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Kie.ai createTask failed (${res.status}): ${text}`);
    }

    const data = await res.json();
    trackCall('kieAi', 'createTask', false);

    const taskId = data.data?.taskId || data.taskId;
    if (!taskId) {
        throw new Error(`Kie.ai createTask returned no taskId: ${JSON.stringify(data)}`);
    }

    return { taskId, enhancedPrompt };
}

export async function getTaskStatus(taskId: string): Promise<TaskStatus> {
    const apiKey = getEnv('KIE_AI_API_KEY');

    const res = await fetch(`${KIE_API_BASE}/recordInfo?taskId=${taskId}`, {
        headers: {
            'Authorization': `Bearer ${apiKey}`,
        },
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Kie.ai recordInfo failed (${res.status}): ${text}`);
    }

    const data = await res.json();
    trackCall('kieAi', 'getTaskStatus', false);

    // Try multiple paths — Kie.ai response structure may nest differently
    const record = data.data || data.record || data;
    if (!record || (!record.state && !record.status)) {
        console.log('[kie-ai] recordInfo: no record found, keys:', Object.keys(data));
        return { status: 'pending' };
    }

    // Kie.ai uses "state" field with values: waiting, queuing, generating, success, fail
    // Some responses may use "status" instead
    const state = record.state || record.status;
    const costTimeMs = record.costTime;

    console.log('[kie-ai] recordInfo state:', state, 'keys:', Object.keys(record));

    if (state === 'success' || state === 'completed' || state === 'done') {
        let imageUrl: string | undefined;

        // Try resultJson first
        try {
            const raw = record.resultJson;
            if (raw) {
                const resultJson = typeof raw === 'string' ? JSON.parse(raw) : raw;
                console.log('[kie-ai] resultJson keys:', Object.keys(resultJson));
                imageUrl = resultJson?.resultUrls?.[0]
                    || resultJson?.output?.image_url
                    || resultJson?.image_url
                    || resultJson?.output?.images?.[0]
                    || resultJson?.url
                    || resultJson?.imageUrl;
            }
        } catch (e) {
            console.error('[kie-ai] resultJson parse error:', e, 'raw:', record.resultJson);
        }

        // Fallback: check direct record fields
        if (!imageUrl) {
            imageUrl = record.resultUrl || record.imageUrl || record.image_url || record.output_url;
        }

        // Fallback: scan resultJson string for URL pattern
        if (!imageUrl && typeof record.resultJson === 'string') {
            const urlMatch = record.resultJson.match(/https?:\/\/[^\s"']+\.(png|jpg|jpeg|webp)/i);
            if (urlMatch) imageUrl = urlMatch[0];
        }

        console.log('[kie-ai] extracted imageUrl:', imageUrl ? imageUrl.substring(0, 80) + '...' : 'NONE');
        return { status: 'success', imageUrl, costTimeMs };
    }

    if (state === 'fail' || state === 'failed' || state === 'error') {
        return { status: 'failed', failMsg: record.failMsg || record.error || 'Generation failed', costTimeMs };
    }

    // waiting, queuing, generating — all mean still processing
    return { status: 'processing' };
}
