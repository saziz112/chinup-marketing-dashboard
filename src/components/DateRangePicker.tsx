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

    const unchanged = localSince === since && localUntil === until;

    return (
        <div className="drp">
            {/* Toggle */}
            <button type="button" className="drp-toggle" onClick={() => setIsMenuOpen(!isMenuOpen)} aria-haspopup="listbox" aria-expanded={isMenuOpen}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                        <line x1="16" y1="2" x2="16" y2="6" />
                        <line x1="8" y1="2" x2="8" y2="6" />
                        <line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                    <span>{labels[preset]}</span>
                </span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transition: 'transform 0.2s', transform: isMenuOpen ? 'rotate(180deg)' : 'none' }}>
                    <polyline points="6 9 12 15 18 9" />
                </svg>
            </button>

            {/* Dropdown */}
            {isMenuOpen && (
                <>
                    <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setIsMenuOpen(false)} />
                    <div className="drp-menu" role="listbox">
                        {(['7d', '30d', 'thisMonth', 'custom'] as PresetRange[]).map(p => (
                            <button
                                key={p}
                                type="button"
                                role="option"
                                aria-selected={preset === p}
                                className={`drp-option ${preset === p ? 'active' : ''}`}
                                onClick={() => handlePresetSelect(p)}
                            >
                                {labels[p]}
                            </button>
                        ))}
                    </div>
                </>
            )}

            {/* Custom Date Inputs */}
            {preset === 'custom' && (
                <div className="drp-custom">
                    <input
                        type="date"
                        aria-label="Start date"
                        value={localSince}
                        max={localUntil}
                        onChange={(e) => setLocalSince(e.target.value)}
                    />
                    <span style={{ color: 'var(--text-muted)' }} aria-hidden="true">to</span>
                    <input
                        type="date"
                        aria-label="End date"
                        value={localUntil}
                        min={localSince}
                        max={format(new Date(), 'yyyy-MM-dd')}
                        onChange={(e) => setLocalUntil(e.target.value)}
                    />
                    <button
                        type="button"
                        className="btn btn-primary"
                        onClick={handleApplyCustom}
                        disabled={unchanged}
                    >
                        Apply
                    </button>
                </div>
            )}
        </div>
    );
}
