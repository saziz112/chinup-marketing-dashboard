import { it, expect, vi } from 'vitest';

const h = vi.hoisted(() => ({ queries: [] as string[] }));
vi.mock('@/lib/db/sql', () => ({
    sql: async (strings: TemplateStringsArray) => {
        h.queries.push(strings.join('?'));
        return { rows: [], rowCount: 2, command: 'UPDATE' };
    },
}));
vi.mock('@/lib/api-usage-tracker', () => ({ trackCall: () => {} }));

import { linkCapturedGclids } from './ghl-contacts-sync';

it('copies captured gclids onto GHL contacts synced after the beacon fired', async () => {
    const linked = await linkCapturedGclids();
    expect(linked).toBe(2);
    const q = h.queries[0];
    expect(q).toContain('UPDATE ghl_contacts_map');
    expect(q).toContain('FROM gclid_captures');
    // the latest click wins, but an unchanged gclid is not rewritten
    expect(q).toMatch(/IS DISTINCT FROM g\.gclid/);
});
