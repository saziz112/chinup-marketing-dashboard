import { describe, it, expect } from 'vitest';
import { filterCampaignRecipients } from './campaign-guard';

const id = (p: string) => `h:${p.replace(/\D/g, '').slice(-10)}`;
const c = (contactId: string, phone: string) => ({ contactId, phone });

describe('filterCampaignRecipients', () => {
    it('skips call-list, bonus-recent, campaign-cooldown and no-phone, in that order of reason', () => {
        const out = filterCampaignRecipients(
            [c('a', '6785550001'), c('b', '6785550002'), c('c', '6785550003'), c('d', ''), c('e', '6785550005')],
            {
                onCallList: new Set([id('6785550001')]),
                bonusBlocked: new Set([id('6785550002')]),
                recentlyCampaigned: new Set([id('6785550003')]),
            },
            id,
        );
        expect(out.send.map(x => x.contactId)).toEqual(['e']);
        expect(out.skipped).toEqual([
            { contactId: 'a', reason: 'call_list' },
            { contactId: 'b', reason: 'bonus_recent' },
            { contactId: 'c', reason: 'campaign_cooldown' },
            { contactId: 'd', reason: 'no_phone' },
        ]);
    });

    it('one phone on two contacts texts once: later contacts are duplicate_phone', () => {
        const none = { onCallList: new Set<string>(), bonusBlocked: new Set<string>(), recentlyCampaigned: new Set<string>() };
        const out = filterCampaignRecipients(
            [c('a', '(678) 555-0001'), c('b', '678-555-0001'), c('x', '6785550009'), c('d', '+1 678 555 0001')],
            none,
            id,
        );
        expect(out.send.map(x => x.contactId)).toEqual(['a', 'x']);
        expect(out.skipped).toEqual([
            { contactId: 'b', reason: 'duplicate_phone' },
            { contactId: 'd', reason: 'duplicate_phone' },
        ]);
    });
});
