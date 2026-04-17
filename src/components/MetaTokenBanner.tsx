'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, XCircle } from 'lucide-react';

interface TokenStatus {
    configured: boolean;
    valid: boolean;
    expiresAt: number | null;
    daysRemaining: number | null;
    error?: string;
}

interface StatusResponse {
    pageToken: TokenStatus;
    adsToken: TokenStatus;
}

const WARN_THRESHOLD_DAYS = 30;

export default function MetaTokenBanner() {
    const [status, setStatus] = useState<StatusResponse | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetch('/api/meta/token-status')
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (!cancelled && d && !d.error) setStatus(d); })
            .catch(() => { /* silent */ });
        return () => { cancelled = true; };
    }, []);

    if (!status) return null;

    const warnings: { token: string; severity: 'warn' | 'error'; message: string }[] = [];

    for (const [label, envName, ts] of [
        ['Page/Publish', 'META_PAGE_ACCESS_TOKEN', status.pageToken],
        ['Ads', 'META_ADS_ACCESS_TOKEN', status.adsToken],
    ] as const) {
        if (!ts.configured) continue;
        if (!ts.valid) {
            warnings.push({
                token: label,
                severity: 'error',
                message: `${label} token (${envName}) is invalid: ${ts.error || 'unknown reason'}. Regenerate in Vercel env vars.`,
            });
            continue;
        }
        if (ts.daysRemaining !== null && ts.daysRemaining <= WARN_THRESHOLD_DAYS) {
            warnings.push({
                token: label,
                severity: ts.daysRemaining <= 7 ? 'error' : 'warn',
                message: `${label} token (${envName}) expires in ${ts.daysRemaining} day${ts.daysRemaining === 1 ? '' : 's'}. Regenerate via Graph API Explorer before it lapses.`,
            });
        }
    }

    if (warnings.length === 0) return null;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
            {warnings.map((w, i) => {
                const isError = w.severity === 'error';
                const color = isError ? '#ef4444' : '#eab308';
                const Icon = isError ? XCircle : AlertTriangle;
                return (
                    <div key={i} style={{
                        padding: '10px 14px', borderRadius: '10px',
                        background: `${color}10`, border: `1px solid ${color}30`,
                        display: 'flex', gap: '10px', alignItems: 'flex-start',
                    }}>
                        <Icon size={16} style={{ color, flexShrink: 0, marginTop: '2px' }} />
                        <span style={{ fontSize: '0.8125rem', color: '#ddd', lineHeight: 1.4 }}>
                            {w.message}
                        </span>
                    </div>
                );
            })}
        </div>
    );
}
