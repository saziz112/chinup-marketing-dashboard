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

    // Determine the preset when since/until props change from outside
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
        } else if (p === 'custom') {
            // Keep current dates but switch to custom mode so inputs show
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
            // Revert on invalid
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

    return (
        <div className="relative">
            {/* Dropdown Toggle */}
            <button
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                className="flex items-center gap-2 bg-slate-900/50 hover:bg-slate-800/80 px-3 py-1.5 rounded-md border border-white/10 text-sm font-medium transition-colors"
                style={{ minWidth: 160, justifyContent: 'space-between' }}
            >
                <div className="flex items-center gap-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                        <line x1="16" y1="2" x2="16" y2="6" />
                        <line x1="8" y1="2" x2="8" y2="6" />
                        <line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                    <span>{labels[preset]}</span>
                </div>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`text-slate-500 transition-transform ${isMenuOpen ? 'rotate-180' : ''}`}>
                    <polyline points="6 9 12 15 18 9" />
                </svg>
            </button>

            {/* Dropdown Menu */}
            {isMenuOpen && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsMenuOpen(false)} />
                    <div className="absolute top-full right-0 mt-2 p-1.5 bg-slate-900 border border-white/10 rounded-lg shadow-xl z-50 w-56 flex flex-col gap-1">
                        {(['7d', '30d', 'thisMonth', 'custom'] as PresetRange[]).map(p => (
                            <button
                                key={p}
                                onClick={() => handlePresetSelect(p)}
                                className={`text-left px-3 py-2 text-sm rounded-md transition-colors ${preset === p ? 'bg-indigo-600/20 text-indigo-400 font-medium' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}
                            >
                                {labels[p]}
                            </button>
                        ))}
                    </div>
                </>
            )}

            {/* Custom Date Inputs (only visible when custom is selected) */}
            {preset === 'custom' && (
                <div className="flex items-center space-x-2 bg-slate-900/50 p-1 mt-2 rounded-md border border-white/10" style={{ animation: 'fadeIn 0.2s ease' }}>
                    <input
                        type="date"
                        value={localSince}
                        max={localUntil}
                        onChange={(e) => setLocalSince(e.target.value)}
                        className="bg-transparent text-sm text-slate-200 border-none outline-none focus:ring-0 px-2 py-1 cursor-pointer"
                    />
                    <span className="text-slate-500">—</span>
                    <input
                        type="date"
                        value={localUntil}
                        min={localSince}
                        max={format(new Date(), 'yyyy-MM-dd')}
                        onChange={(e) => setLocalUntil(e.target.value)}
                        className="bg-transparent text-sm text-slate-200 border-none outline-none focus:ring-0 px-2 py-1 cursor-pointer"
                    />
                    <button
                        onClick={handleApplyCustom}
                        disabled={localSince === since && localUntil === until}
                        className="px-3 py-1 text-xs font-semibold rounded bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        Apply
                    </button>
                </div>
            )}
        </div>
    );
}
