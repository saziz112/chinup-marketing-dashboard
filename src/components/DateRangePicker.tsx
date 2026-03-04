'use client';

import { useState, useEffect } from 'react';
import { format, subDays, startOfMonth, parseISO, isValid } from 'date-fns';

interface DateRangePickerProps {
    since: string;
    until: string;
    onChange: (since: string, until: string) => void;
}

type PresetRange = '7d' | '30d' | 'thisMonth' | 'custom';

export function DateRangePicker({ since, until, onChange }: DateRangePickerProps) {
    const [localSince, setLocalSince] = useState(since);
    const [localUntil, setLocalUntil] = useState(until);
    const [preset, setPreset] = useState<PresetRange>('30d');
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    useEffect(() => {
        setLocalSince(since);
        setLocalUntil(until);

        const today = new Date();
        const fToday = format(today, 'yyyy-MM-dd');

        if (until === fToday && since === format(subDays(today, 6), 'yyyy-MM-dd')) {
            setPreset('7d');
        } else if (until === fToday && since === format(subDays(today, 29), 'yyyy-MM-dd')) {
            setPreset('30d');
        } else if (until === fToday && since === format(startOfMonth(today), 'yyyy-MM-dd')) {
            setPreset('thisMonth');
        } else {
            setPreset('custom');
        }
    }, [since, until]);

    const handlePresetSelect = (p: PresetRange) => {
        setPreset(p);
        setIsMenuOpen(false);
        const today = new Date();
        const fToday = format(today, 'yyyy-MM-dd');

        if (p === '7d') {
            onChange(format(subDays(today, 6), 'yyyy-MM-dd'), fToday);
        } else if (p === '30d') {
            onChange(format(subDays(today, 29), 'yyyy-MM-dd'), fToday);
        } else if (p === 'thisMonth') {
            onChange(format(startOfMonth(today), 'yyyy-MM-dd'), fToday);
        }
    };

    const handleApplyCustom = () => {
        if (!localSince || !localUntil) return;
        const dSince = parseISO(localSince);
        const dUntil = parseISO(localUntil);

        if (isValid(dSince) && isValid(dUntil) && dSince <= dUntil) {
            setPreset('custom');
            onChange(localSince, localUntil);
        } else {
            setLocalSince(since);
            setLocalUntil(until);
        }
    };

    const labels: Record<PresetRange, string> = {
        '7d': 'Last 7 Days',
        '30d': 'Last 30 Days',
        'thisMonth': 'This Month',
        'custom': 'Custom Range'
    };

    const btnBase: React.CSSProperties = {
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '8px 14px', borderRadius: '8px',
        border: '1px solid var(--border-color)',
        background: 'rgba(255,255,255,0.04)',
        color: '#fff', fontSize: '0.8125rem', fontWeight: 500,
        cursor: 'pointer', minWidth: 160, justifyContent: 'space-between',
        transition: 'background 0.2s',
    };

    return (
        <div style={{ position: 'relative' }}>
            {/* Toggle */}
            <button onClick={() => setIsMenuOpen(!isMenuOpen)} style={btnBase}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)' }}>
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                        <line x1="16" y1="2" x2="16" y2="6" />
                        <line x1="8" y1="2" x2="8" y2="6" />
                        <line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                    <span>{labels[preset]}</span>
                </div>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)', transition: 'transform 0.2s', transform: isMenuOpen ? 'rotate(180deg)' : 'none' }}>
                    <polyline points="6 9 12 15 18 9" />
                </svg>
            </button>

            {/* Dropdown */}
            {isMenuOpen && (
                <>
                    <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setIsMenuOpen(false)} />
                    <div style={{
                        position: 'absolute', top: '100%', right: 0, marginTop: '8px', padding: '6px',
                        background: 'var(--card-bg)', border: '1px solid var(--border-color)',
                        borderRadius: '10px', boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                        zIndex: 50, width: '220px', display: 'flex', flexDirection: 'column', gap: '2px',
                    }}>
                        {(['7d', '30d', 'thisMonth', 'custom'] as PresetRange[]).map(p => (
                            <button
                                key={p}
                                onClick={() => handlePresetSelect(p)}
                                style={{
                                    textAlign: 'left', padding: '8px 14px', fontSize: '0.8125rem',
                                    borderRadius: '6px', border: 'none', cursor: 'pointer',
                                    transition: 'all 0.15s',
                                    background: preset === p ? 'rgba(var(--accent-rgb, 212,175,55), 0.15)' : 'transparent',
                                    color: preset === p ? 'var(--accent)' : '#ccc',
                                    fontWeight: preset === p ? 600 : 400,
                                }}
                            >
                                {labels[p]}
                            </button>
                        ))}
                    </div>
                </>
            )}

            {/* Custom Date Inputs */}
            {preset === 'custom' && (
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    background: 'rgba(255,255,255,0.04)', padding: '6px',
                    marginTop: '8px', borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                }}>
                    <input
                        type="date"
                        value={localSince}
                        max={localUntil}
                        onChange={(e) => setLocalSince(e.target.value)}
                        style={{
                            background: 'transparent', border: 'none', outline: 'none',
                            color: '#fff', fontSize: '0.8125rem', padding: '4px 8px', cursor: 'pointer',
                        }}
                    />
                    <span style={{ color: 'var(--text-muted)' }}>—</span>
                    <input
                        type="date"
                        value={localUntil}
                        min={localSince}
                        max={format(new Date(), 'yyyy-MM-dd')}
                        onChange={(e) => setLocalUntil(e.target.value)}
                        style={{
                            background: 'transparent', border: 'none', outline: 'none',
                            color: '#fff', fontSize: '0.8125rem', padding: '4px 8px', cursor: 'pointer',
                        }}
                    />
                    <button
                        onClick={handleApplyCustom}
                        disabled={localSince === since && localUntil === until}
                        style={{
                            padding: '6px 16px', borderRadius: '6px', border: 'none', cursor: 'pointer',
                            fontSize: '0.75rem', fontWeight: 600,
                            background: 'var(--accent)', color: '#000',
                            opacity: (localSince === since && localUntil === until) ? 0.5 : 1,
                            transition: 'opacity 0.2s',
                        }}
                    >
                        Apply
                    </button>
                </div>
            )}
        </div>
    );
}
