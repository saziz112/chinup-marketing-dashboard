/** Shared constants — platform colors, tooltip styles, location options */

export const PLATFORM_COLORS: Record<string, string> = {
    instagram: '#E1306C',
    facebook: '#1877F2',
    youtube: '#FF0000',
    tiktok: '#000000',
    'google-business': '#4285F4',
};

export const TOOLTIP_STYLE: React.CSSProperties = {
    background: '#0A225C',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: '#FEFEFE',
    fontSize: '0.85rem',
};

export type LocationFilter = 'all' | 'decatur' | 'smyrna' | 'kennesaw';

export const LOCATION_OPTIONS: { id: LocationFilter; label: string }[] = [
    { id: 'all', label: 'All Locations' },
    { id: 'decatur', label: 'Decatur' },
    { id: 'smyrna', label: 'Smyrna/Vinings' },
    { id: 'kennesaw', label: 'Kennesaw' },
];
