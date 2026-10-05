/**
 * Who a campaign may text right now (Sam, 2026-10-05). Applied on the server
 * at send time, never trusted from the page: the outreach call list, anyone
 * the bonus dashboard texted recently, and this app's own 30-day cooldown.
 */
export type SkipReason = 'call_list' | 'bonus_recent' | 'campaign_cooldown' | 'no_phone';

export function filterCampaignRecipients<T extends { contactId: string; phone: string }>(
    contacts: T[],
    blocks: { onCallList: Set<string>; bonusBlocked: Set<string>; recentlyCampaigned: Set<string> },
    hash: (phone: string) => string,
): { send: T[]; skipped: { contactId: string; reason: SkipReason }[] } {
    const send: T[] = [];
    const skipped: { contactId: string; reason: SkipReason }[] = [];
    for (const c of contacts) {
        if (!c.phone) { skipped.push({ contactId: c.contactId, reason: 'no_phone' }); continue; }
        const h = hash(c.phone);
        if (blocks.onCallList.has(h)) skipped.push({ contactId: c.contactId, reason: 'call_list' });
        else if (blocks.bonusBlocked.has(h)) skipped.push({ contactId: c.contactId, reason: 'bonus_recent' });
        else if (blocks.recentlyCampaigned.has(h)) skipped.push({ contactId: c.contactId, reason: 'campaign_cooldown' });
        else send.push(c);
    }
    return { send, skipped };
}
