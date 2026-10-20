import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { email: 'x@y.com' } }) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/db/sql', () => ({ sql: vi.fn(async () => ({ rows: [] })) }));
vi.mock('@/lib/db', () => ({ ensureContentResearchTables: async () => {} }));

async function post(body: unknown) {
    vi.resetModules();
    const { POST } = await import('./route');
    return POST(new NextRequest('http://x/api/research/hooks', { method: 'POST', body: JSON.stringify(body) }));
}

function claudeReturns(payload: unknown) {
    const fetchMock = vi.fn(async () => ({
        ok: true, status: 200,
        json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(payload) }] }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

describe('POST /api/research/hooks', () => {
    beforeEach(() => { vi.stubEnv('ANTHROPIC_API_KEY', 'k'); vi.spyOn(console, 'error').mockImplementation(() => {}); });
    afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

    it('requires a real price and never calls Claude without one', async () => {
        const fetchMock = claudeReturns({});
        for (const price of ['', 'free', '20% off', '0']) {
            const res = await post({ treatment: 'Botox', price });
            expect(res.status).toBe(400);
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('checks every hook and sorts passing ones first', async () => {
        const fetchMock = claudeReturns({
            hooks: ['Glow up with our best deal yet.', 'Botox is $199 at Chin Up. Book now.'],
            script: { hook: 'Botox for $199? Yes.', beats: ['a', 'b', 'c'], cta: 'Book at Chin Up.' },
        });
        const res = await post({ treatment: 'Botox', price: '$199' });
        const json = await res.json();
        expect(res.status).toBe(200);
        expect(json.hooks[0]).toMatchObject({ text: 'Botox is $199 at Chin Up. Book now.', check: { ok: true } });
        expect(json.hooks[1].check.problems).toContain("Doesn't say the price ($199).");
        expect(json.script.check.ok).toBe(true);

        const sent = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
        expect(sent.model).toBe('claude-sonnet-5-5');
        expect(sent.messages[0].content).toContain('"$199"');
    });
});
