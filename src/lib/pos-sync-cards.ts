/**
 * Settings → Data Sync "POS" cards. The tables hold frozen MindBody history plus live
 * Zenoti rows, so each card shows the combined total but dates it by the Zenoti sync.
 * (It used to show MindBody's last sync, which made current data look months stale.)
 */

export interface StatCard { label: string; value: string; sub: string }

const day = (d: unknown) => (typeof d === 'string' && d ? d.slice(0, 10) : null);

export function posSyncCards(status: any): StatCard[] {
    const mb = status?.mindbody ?? {};
    const z = status?.zenoti;
    const total = (n: unknown) => Number(n ?? 0).toLocaleString('en-US');

    if (!z?.migrated) {
        const mbDate = (type: string) => mb.syncStates?.find((s: any) => s.syncType === type)?.lastSyncDate || 'Never synced';
        return [
            { label: 'POS Sales', value: total(mb.salesCount), sub: mbDate('sales') },
            { label: 'POS Appointments', value: total(mb.appointmentsCount), sub: mbDate('appointments') },
            { label: 'POS Clients', value: total(mb.clientsCount), sub: mbDate('clients') },
        ];
    }

    const zDate = (type: string) => day(z.syncStates?.find((s: any) => s.sync_type === type)?.last_sync_date);
    const sub = (key: 'sales' | 'appts' | 'clients', synced: string | null) => {
        const n = z.bySource?.[key] ?? {};
        return `Zenoti ${total(n.zenoti)} · ${synced ? `synced ${synced}` : 'never synced'} · MindBody ${total(n.mindbody)} (frozen)`;
    };
    return [
        { label: 'POS Sales', value: total(mb.salesCount), sub: sub('sales', zDate('zenoti_sales')) },
        { label: 'POS Appointments', value: total(mb.appointmentsCount), sub: sub('appts', zDate('zenoti_appointments')) },
        { label: 'POS Clients', value: total(mb.clientsCount), sub: sub('clients', day(z.clientsLastSync)) },
    ];
}
