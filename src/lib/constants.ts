/** Shared constants — platform colors, tooltip styles, location options */

export const PLATFORM_COLORS: Record<string, string> = {
    instagram: '#E1306C',
    facebook: '#1877F2',
    youtube: '#FF0000',
    tiktok: '#000000',
    'google-business': '#4285F4',
};

export const TOOLTIP_STYLE: React.CSSProperties = {
    background: '#0B1D47',
    border: '1px solid rgba(255,255,255,0.14)',
    borderRadius: '10px',
    boxShadow: '0 12px 32px rgba(1,6,24,0.55)',
    color: '#FEFEFE',
    fontSize: '0.8125rem',
    padding: '8px 12px',
};

/** Shared recharts axis + grid styling so every chart reads as one system */
export const AXIS_TICK = { fill: '#A1A1AA', fontSize: 11 };
export const AXIS_PROPS = { stroke: 'transparent', tickLine: false, tick: AXIS_TICK } as const;
export const GRID_PROPS = { strokeDasharray: '3 3', stroke: 'rgba(255,255,255,0.06)', vertical: false } as const;

export type LocationFilter = 'all' | 'decatur' | 'smyrna' | 'kennesaw';

export const LOCATION_OPTIONS: { id: LocationFilter; label: string }[] = [
    { id: 'all', label: 'All Locations' },
    { id: 'decatur', label: 'Decatur' },
    { id: 'smyrna', label: 'Smyrna/Vinings' },
    { id: 'kennesaw', label: 'Kennesaw' },
];
