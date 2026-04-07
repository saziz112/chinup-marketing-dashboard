/** Shared formatting utilities — used across pages and lib modules */

export function formatNumber(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toLocaleString();
}

export function formatCurrency(val: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);
}

export function fmt$(n: number | null | undefined, currency = 'USD'): string {
    if (n === null || n === undefined) return '\u2014';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

export function fmtNum(n: number | undefined, decimals = 0): string {
    if (n === undefined || n === null) return '\u2014';
    return n.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function fmtPct(n: number | undefined): string {
    if (n === undefined || n === null) return '\u2014';
    return n.toFixed(2) + '%';
}

export function formatDate(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
