/**
 * Kie.ai API Client — Nano Banana 2 Image Generation
 * Creates AI images for social media content.
 * Async workflow: createTask → poll recordInfo until complete.
 */

import { trackCall } from '@/lib/api-usage-tracker';

const KIE_API_BASE = 'https://api.kie.ai/api/v1/jobs';

// --- Types ---

export type CreativeStyle = 'photorealistic' | 'cinematic' | 'product-shot' | 'fashion' | 'beauty-closeup' | 'logo-design';
export type AspectRatio = '1:1' | '4:5' | '9:16' | '3:4' | '4:3' | '16:9';
export type Resolution = '1024' | '2048' | '4096';

export interface GenerateRequest {
    prompt: string;
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

const STYLE_PREFIXES: Record<CreativeStyle, string> = {
    'photorealistic': 'Ultra-realistic photograph, natural lighting, high detail',
    'cinematic': 'Cinematic film still, dramatic lighting, shallow depth of field, anamorphic lens',
    'product-shot': 'Professional product photography, clean white background, studio lighting',
    'fashion': 'High-end fashion editorial, luxury aesthetic, editorial lighting',
    'beauty-closeup': 'Professional beauty photography, macro detail, soft even lighting, flawless skin texture',
    'logo-design': 'Minimalist modern logo, vector-style, clean lines, professional branding',
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

export function enhancePrompt(userPrompt: string, style: CreativeStyle, aspectRatio: AspectRatio, brandContext?: string, includeBrandLogo?: boolean): string {
    const prefix = STYLE_PREFIXES[style];
    const arContext = ASPECT_RATIO_CONTEXT[aspectRatio];
    const brand = brandContext ? ` ${brandContext}.` : '';
    const logo = includeBrandLogo ? ' Include a subtle, small brand logo watermark in the corner of the image.' : '';
    const suffix = '8K resolution, professional quality, sharp focus, vibrant colors';
    return `${prefix}, ${arContext}.${brand} ${userPrompt}.${logo} ${suffix}`;
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
        model: 'nano-banana-2',
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
