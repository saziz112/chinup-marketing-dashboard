import { describe, it, expect } from 'vitest';
import { posSyncCards } from './pos-sync-cards';

const status = {
    mindbody: {
        salesCount: 26479, appointmentsCount: 24599, clientsCount: 8331,
        syncStates: [
            { syncType: 'sales', lastSyncDate: '2026-07-06' },
            { syncType: 'appointments', lastSyncDate: '2026-07-06' },
            { syncType: 'clients', lastSyncDate: '2026-04-02' },
        ],
    },
    zenoti: {
        migrated: true,
        bySource: {
            sales: { zenoti: 4101, mindbody: 22378 },
            appts: { zenoti: 4827, mindbody: 19772 },
            clients: { zenoti: 1494, mindbody: 6837 },
        },
        syncStates: [
            { sync_type: 'zenoti_sales', last_sync_date: '2026-10-20T00:00:00.000Z' },
            { sync_type: 'zenoti_appointments', last_sync_date: '2026-10-20T00:00:00.000Z' },
            { sync_type: 'zenoti_guests', last_sync_date: '2026-07-06T00:00:00.000Z' },
        ],
        clientsLastSync: '2026-10-20T08:31:46.767Z',
    },
};

describe('posSyncCards', () => {
    it('dates each card by its Zenoti sync and names MindBody as frozen history', () => {
        expect(posSyncCards(status)).toEqual([
            { label: 'POS Sales', value: '26,479', sub: 'Zenoti 4,101 · synced 2026-10-20 · MindBody 22,378 (frozen)' },
            { label: 'POS Appointments', value: '24,599', sub: 'Zenoti 4,827 · synced 2026-10-20 · MindBody 19,772 (frozen)' },
            // clients ride along with the daily appointment sync, so date them by their own
            // last update, not the one-time zenoti_guests backfill row (2026-07-06)
            { label: 'POS Clients', value: '8,331', sub: 'Zenoti 1,494 · synced 2026-10-20 · MindBody 6,837 (frozen)' },
        ]);
    });

    it('says when Zenoti has never synced', () => {
        const cards = posSyncCards({ ...status, zenoti: { ...status.zenoti, syncStates: [], clientsLastSync: null } });
        expect(cards[0].sub).toBe('Zenoti 4,101 · never synced · MindBody 22,378 (frozen)');
    });

    it('falls back to the MindBody dates before the Zenoti migration', () => {
        const cards = posSyncCards({ mindbody: status.mindbody, zenoti: { migrated: false } });
        expect(cards.map(c => c.sub)).toEqual(['2026-07-06', '2026-07-06', '2026-04-02']);
    });
});
