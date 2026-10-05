import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/api-usage-tracker', () => ({ trackCall: vi.fn() }));

import { sendBulkSMS } from './ghl-messaging';

const contact = (id: string, tags: string[] = []) => ({
    contactId: id, contactName: `Name ${id}`, firstName: id, phone: '4045551234', tags,
});

describe('sendBulkSMS onResult', () => {
    beforeEach(() => {
        process.env.GHL_LOCATION_ID_KENNESAW = 'loc';
        process.env.GHL_PIT_KENNESAW = 'pit';
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ messageId: 'm1' }) })));
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('calls onResult after each send, before the next one, and survives an onResult error', async () => {
        const seen: string[] = [];
        const fetchMock = vi.mocked(fetch);
        const onResult = vi.fn(async (r: { contactId: string }) => {
            // the next send must not have started yet
            expect(fetchMock.mock.calls.length).toBe(seen.length + 1);
            seen.push(r.contactId);
            if (r.contactId === 'a') throw new Error('db');
        });
        const res = await sendBulkSMS('kennesaw', [contact('a'), contact('b')], 'Hi {{firstName}}', 'Kennesaw', onResult);
        expect(seen).toEqual(['a', 'b']);
        expect(res.sent).toBe(2);
    });

    it('also reports DND-skipped contacts as unsuccessful', async () => {
        const onResult = vi.fn(async () => {});
        await sendBulkSMS('kennesaw', [contact('a', ['dnd'])], 'Hi', 'Kennesaw', onResult);
        expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ contactId: 'a', success: false }));
        expect(fetch).not.toHaveBeenCalled();
    });
});
