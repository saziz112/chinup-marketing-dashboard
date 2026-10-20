/**
 * Minimal Claude call that returns schema-checked JSON. Matches the repo's
 * raw-fetch pattern (no SDK dependency).
 */

export const RESEARCH_MODEL = 'claude-sonnet-5-5';

export async function claudeJson<T>(opts: {
    system: string;
    prompt: string;
    schema: Record<string, unknown>;
    maxTokens?: number;
}): Promise<T> {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY is not set');

    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model: RESEARCH_MODEL,
            max_tokens: opts.maxTokens ?? 4000,
            system: opts.system,
            messages: [{ role: 'user', content: opts.prompt }],
            output_config: { effort: 'medium', format: { type: 'json_schema', schema: opts.schema } },
        }),
    });

    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Claude API ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = await res.json();
    if (data.stop_reason === 'refusal') throw new Error('Claude declined this request');
    if (data.stop_reason === 'max_tokens') throw new Error('Claude ran out of room; try again');
    const text = (data.content || []).find((b: { type: string }) => b.type === 'text')?.text;
    if (!text) throw new Error('Claude returned no text');
    return JSON.parse(text) as T;
}
