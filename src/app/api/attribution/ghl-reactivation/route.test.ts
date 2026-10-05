import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
    sql: vi.fn(),
    sendBulkSMS: vi.fn(),
    getContactForSend: vi.fn(),
    getOutreachListHashes: vi.fn(),
    getBonusBlockedHashes: vi.fn(),
}));

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { email: 'a@b.c', isAdmin: true } })) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/db/sql', () => ({ sql: h.sql }));
vi.mock('@/lib/integrations/gohighlevel', () => ({ isGHLConfigured: () => true, getLocations: () => [] }));
vi.mock('@/lib/integrations/ghl-conversations', () => ({
    getConversationsIntelligence: vi.fn(), getLapsedPatients: vi.fn(), getConsultOnlyPatients: vi.fn(),
    getMaintenanceDuePatients: vi.fn(async () => []), getNoShowRecoveryPatients: vi.fn(),
    buildUnifiedPhoneMap: vi.fn(), getRecentOutboundContactIds: vi.fn(), getV2SmsDndContactIds: vi.fn(),
}));
vi.mock('@/lib/integrations/ghl-messaging', () => ({
    sendBulkSMS: h.sendBulkSMS, sendBulkEmail: vi.fn(), SMS_TEMPLATES: {}, EMAIL_TEMPLATES: {},
    sendSMS: vi.fn(), sendEmail: vi.fn(), renderTemplate: vi.fn(),
    isDNDContact: () => false, getV2Config: () => ({ locationId: 'l', pit: 'p' }),
    getContactForSend: h.getContactForSend,
}));
vi.mock('@/lib/integrations/mindbody', () => ({ normalizePhone: (p: string) => p }));
vi.mock('@/lib/outreach-list', () => ({
    getOutreachListHashes: h.getOutreachListHashes, getBonusBlockedHashes: h.getBonusBlockedHashes,
}));

import { POST } from './route';

const req = (ids: string[]) => ({
    json: async () => ({ contactIds: ids, message: 'Hi', locationKey: 'kennesaw', channel: 'sms', segment: 'x', contacts: [] }),
}) as never;

const good = { firstName: 'A', lastName: 'B', phone: '4045551234', tags: [], smsDnd: false };

describe('ghl-reactivation POST (sms)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        h.getOutreachListHashes.mockResolvedValue(new Set());
        h.getBonusBlockedHashes.mockResolvedValue(new Set());
        h.getContactForSend.mockResolvedValue(good);
        h.sql.mockResolvedValue({ rows: [] });
    });

    it('returns 503 and sends nothing when the bonus check throws', async () => {
        h.getBonusBlockedHashes.mockRejectedValue(new Error('bonus recent-contacts returned 404'));
        const res = await POST(req(['c1']));
        expect(res.status).toBe(503);
        expect(h.sendBulkSMS).not.toHaveBeenCalled();
    });

    it('returns 500 and sends nothing when the run row insert fails', async () => {
        h.sql.mockImplementation(async (strings: TemplateStringsArray) => {
            if (strings.join('').includes('INSERT INTO campaign_runs')) throw new Error('db down');
            return { rows: [] };
        });
        const res = await POST(req(['c1']));
        expect(res.status).toBe(500);
        expect(h.sendBulkSMS).not.toHaveBeenCalled();
    });

    it('drops a contact whose v2 lookup fails and counts it', async () => {
        h.getContactForSend.mockImplementation(async (_l: string, id: string) => {
            if (id === 'bad') throw new Error('timeout');
            return good;
        });
        h.sql.mockImplementation(async (strings: TemplateStringsArray) =>
            strings.join('').includes('RETURNING run_id') ? { rows: [{ run_id: 'r1' }] } : { rows: [] });
        h.sendBulkSMS.mockResolvedValue({ results: [], sent: 1, failed: 0, skipped: 0 });
        const res = await POST(req(['good', 'bad']));
        const body = await res.json();
        expect(body.guardSkipped.lookup_failed).toBe(1);
        const sentContacts = h.sendBulkSMS.mock.calls[0][1];
        expect(sentContacts.map((c: { contactId: string }) => c.contactId)).toEqual(['good']);
    });
});
