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
    referenceImageUrl?: string;
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

export function enhancePrompt(userPrompt: string, style: CreativeStyle, aspectRatio: AspectRatio): string {
    const prefix = STYLE_PREFIXES[style];
    const arContext = ASPECT_RATIO_CONTEXT[aspectRatio];
    const suffix = '8K resolution, professional quality, sharp focus, vibrant colors';
    return `${prefix}, ${arContext}. ${userPrompt}. ${suffix}`;
}

// --- API Calls ---

const RESOLUTION_LABEL: Record<Resolution, string> = {
    '1024': '1K',
    '2048': '2K',
    '4096': '4K',
};

export async function createImageTask(req: GenerateRequest): Promise<GenerateResult> {
    const apiKey = getEnv('KIE_AI_API_KEY');
    const enhancedPrompt = enhancePrompt(req.prompt, req.style, req.aspectRatio);

    const input: Record<string, unknown> = {
        prompt: enhancedPrompt,
        aspect_ratio: req.aspectRatio,
        resolution: RESOLUTION_LABEL[req.resolution],
        output_format: 'png',
        google_search: false,
        image_input: req.referenceImageUrl ? [req.referenceImageUrl] : [],
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

    const record = data.data;
    if (!record) {
        return { status: 'pending' };
    }

    const status = record.status;
    const costTimeMs = record.costTime;

    if (status === 'SUCCESS' || status === 'success') {
        // Extract image URL from resultJson — multiple possible structures
        let imageUrl: string | undefined;
        try {
            const resultJson = typeof record.resultJson === 'string'
                ? JSON.parse(record.resultJson)
                : record.resultJson;

            imageUrl = resultJson?.output?.image_url
                || resultJson?.image_url
                || resultJson?.output?.images?.[0]
                || resultJson?.images?.[0];
        } catch {
            // resultJson may not be parseable
        }

        // Fallback to direct fields
        if (!imageUrl) {
            imageUrl = record.resultUrl || record.imageUrl;
        }

        return { status: 'success', imageUrl, costTimeMs };
    }

    if (status === 'FAILED' || status === 'failed') {
        return { status: 'failed', failMsg: record.failMsg || 'Generation failed', costTimeMs };
    }

    if (status === 'PROCESSING' || status === 'processing' || status === 'RUNNING') {
        return { status: 'processing' };
    }

    return { status: 'pending' };
}
