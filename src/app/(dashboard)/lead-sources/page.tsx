'use client';

import { useSession } from 'next-auth/react';
import { useState, useEffect, useCallback } from 'react';
import { formatNumber, formatCurrency } from '@/lib/format';
import { LOCATION_OPTIONS, type LocationFilter } from '@/lib/constants';

interface Row {
    channel: string;
    leads: number;
    newLeads: number;
    existingPatients: number;
    showed: number;
    showRate: number | null;
    revenue?: number;
    revPerLead?: number | null;
    suppressed: boolean;
}

interface Report {
    rows: Row[];
    totals: { leads: number; newLeads: number; showed: number; revenue?: number };
    window: { cohortStart: string; cohortEnd: string; maturationDays: number; location: string | null };
    unbackfilled: number;
    generatedAt: string;
}

const COHORTS = [
    { id: '30-90', label: '30-90 days', minAge: 30, maxAge: 90 },
    { id: '30-180', label: '30-180 days', minAge: 30, maxAge: 180 },
    { id: '7-60', label: '7-60 days', minAge: 7, maxAge: 60 },
] as const;

export default function LeadSourcesPage() {
    const { data: session } = useSession();
    const isAdmin = (session?.user as Record<string, unknown> | undefined)?.isAdmin === true;

    const [location, setLocation] = useState<LocationFilter>('all');
    const [cohort, setCohort] = useState<string>('30-90');
    const [data, setData] = useState<Report | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        const c = COHORTS.find(x => x.id === cohort) ?? COHORTS[0];
        const params = new URLSearchParams({
            minAge: String(c.minAge),
            maxAge: String(c.maxAge),
            maturation: '30',
        });
        if (location !== 'all') params.set('location', location);
        try {
            const res = await fetch(`/api/lead-sources?${params}`);
            if (!res.ok) throw new Error((await res.json()).error || 'Request failed');
            setData(await res.json());
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load');
        } finally {
            setLoading(false);
        }
    }, [location, cohort]);

    useEffect(() => { load(); }, [load]);

    const activeCohort = COHORTS.find(x => x.id === cohort) ?? COHORTS[0];
    const totalShowRate = data?.totals.newLeads
        ? (data.totals.showed / data.totals.newLeads) * 100
        : null;

    return (
        <div>
            <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
                <div>
                    <h1>Lead Sources</h1>
                    <p className="subtitle">
                        Where leads come from, and what each is worth within {data?.window.maturationDays ?? 30} days of the lead
                    </p>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {LOCATION_OPTIONS.map(opt => (
                        <button
                            key={opt.id}
                            className={`period-btn ${location === opt.id ? 'active' : ''}`}
                            onClick={() => setLocation(opt.id)}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
                <span style={{ alignSelf: 'center', fontSize: '13px', opacity: 0.7 }}>Lead age:</span>
                {COHORTS.map(opt => (
                    <button
                        key={opt.id}
                        className={`period-btn ${cohort === opt.id ? 'active' : ''}`}
                        onClick={() => setCohort(opt.id)}
                    >
                        {opt.label}
                    </button>
                ))}
            </div>

            {loading && <div className="section-card"><div className="empty-state">Loading…</div></div>}
            {error && <div className="section-card"><div className="empty-state">{error}</div></div>}

            {data && !loading && (
                <>
                    <div className="metrics-grid">
                        <div className="metric-card">
                            <div className="label">New leads</div>
                            <div className="value">{formatNumber(data.totals.newLeads)}</div>
                        </div>
                        <div className="metric-card">
                            <div className="label">Showed</div>
                            <div className="value">{formatNumber(data.totals.showed)}</div>
                        </div>
                        <div className="metric-card">
                            <div className="label">Show rate</div>
                            <div className="value">{totalShowRate === null ? '—' : `${totalShowRate.toFixed(0)}%`}</div>
                        </div>
                        {isAdmin && (
                            <div className="metric-card">
                                <div className="label">Revenue in {data.window.maturationDays}d</div>
                                <div className="value">{formatCurrency(data.totals.revenue ?? 0)}</div>
                            </div>
                        )}
                    </div>

                    <div className="section-card">
                        <div className="chart-header">
                            <h2>By source</h2>
                            {data.unbackfilled > 0 && (
                                <span className="badge warning">
                                    {formatNumber(data.unbackfilled)} awaiting attribution backfill
                                </span>
                            )}
                        </div>
                        <div className="data-table-wrapper">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Source</th>
                                        <th style={{ textAlign: 'right' }}>New leads</th>
                                        <th style={{ textAlign: 'right' }}>Showed</th>
                                        <th style={{ textAlign: 'right' }}>Show rate</th>
                                        {isAdmin && <th style={{ textAlign: 'right' }}>Revenue</th>}
                                        {isAdmin && <th style={{ textAlign: 'right' }}>Rev / lead</th>}
                                        <th style={{ textAlign: 'right' }}>Existing patients</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.rows.map(r => (
                                        <tr key={r.channel}>
                                            <td>{r.channel}</td>
                                            <td style={{ textAlign: 'right' }}>{formatNumber(r.newLeads)}</td>
                                            <td style={{ textAlign: 'right' }}>{formatNumber(r.showed)}</td>
                                            <td style={{ textAlign: 'right' }}>
                                                {r.showRate === null ? (
                                                    <span
                                                        style={{ opacity: 0.5 }}
                                                        title={`n=${r.newLeads} — below the n=30 reporting threshold`}
                                                    >
                                                        n too small
                                                    </span>
                                                ) : `${(r.showRate * 100).toFixed(0)}%`}
                                            </td>
                                            {isAdmin && (
                                                <td style={{ textAlign: 'right' }}>{formatCurrency(r.revenue ?? 0)}</td>
                                            )}
                                            {isAdmin && (
                                                <td style={{ textAlign: 'right' }}>
                                                    {r.revPerLead == null
                                                        ? <span style={{ opacity: 0.5 }}>—</span>
                                                        : formatCurrency(r.revPerLead)}
                                                </td>
                                            )}
                                            <td style={{ textAlign: 'right', opacity: 0.6 }}>
                                                {formatNumber(r.existingPatients)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr>
                                        <td><strong>Total</strong></td>
                                        <td style={{ textAlign: 'right' }}><strong>{formatNumber(data.totals.newLeads)}</strong></td>
                                        <td style={{ textAlign: 'right' }}><strong>{formatNumber(data.totals.showed)}</strong></td>
                                        <td style={{ textAlign: 'right' }}>
                                            <strong>{totalShowRate === null ? '—' : `${totalShowRate.toFixed(0)}%`}</strong>
                                        </td>
                                        {isAdmin && (
                                            <td style={{ textAlign: 'right' }}>
                                                <strong>{formatCurrency(data.totals.revenue ?? 0)}</strong>
                                            </td>
                                        )}
                                        {isAdmin && <td />}
                                        <td />
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>

                    <div className="section-card">
                        <div className="chart-header"><h2>How to read this</h2></div>
                        <ul style={{ lineHeight: 1.7, paddingLeft: '20px', fontSize: '14px' }}>
                            <li>
                                <strong>Revenue is associated, not caused.</strong> No holdout exists, so this ranks
                                sources — it does not prove one caused the return.
                            </li>
                            <li>
                                <strong>Every lead gets {data.window.maturationDays} days to convert.</strong> That
                                keeps sources comparable, but for a med spa it understates lifetime value.
                            </li>
                            <li>
                                <strong>Cohort is leads {activeCohort.label} old.</strong> Newer leads are excluded
                                because they have not had time to convert and would drag their source down unfairly.
                            </li>
                            <li>
                                <strong>Rows under 30 leads show no rate.</strong> The counts are too small to
                                support a percentage.
                            </li>
                            <li>
                                <strong>Call-In counts first-time callers only.</strong> A known patient who phones
                                in is not captured, so treat it as a floor rather than a call count.
                            </li>
                            <li>
                                <strong>Existing patients are excluded from rates and revenue,</strong> and shown
                                separately so you can see how much of a source is repeat business.
                            </li>
                            {data.unbackfilled > 0 && (
                                <li>
                                    <strong>{formatNumber(data.unbackfilled)} contacts have no attribution data yet.</strong>{' '}
                                    They sit in Unattributed until the backfill reaches them, which understates every
                                    named source.
                                </li>
                            )}
                        </ul>
                    </div>
                </>
            )}
        </div>
    );
}
