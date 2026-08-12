'use client';

import { useSession } from 'next-auth/react';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { formatNumber, formatCurrency } from '@/lib/format';
import { LOCATION_OPTIONS, type LocationFilter } from '@/lib/constants';

interface Row {
    channel: string;
    leads: number;
    newLeads: number;
    existingPatients: number;
    purchased: number;
    purchaseRate: number | null;
    revenue?: number;
    revenueToDate?: number;
    revPerLead?: number | null;
    suppressed: boolean;
}

interface Report {
    rows: Row[];
    totals: {
        leads: number;
        newLeads: number;
        purchased: number;
        revenue?: number;
        revenueToDate?: number;
    };
    window: {
        cohortStart: string;
        cohortEnd: string;
        maturationDays: number;
        location: string | null;
        matured: boolean;
        maturesOn: string | null;
        maturedShare: number;
    };
    unbackfilled: number;
    generatedAt: string;
}

const COHORTS = [
    { id: '30-90', label: '30-90 days', minAge: 30, maxAge: 90 },
    { id: '30-180', label: '30-180 days', minAge: 30, maxAge: 180 },
    { id: '7-60', label: '7-60 days', minAge: 7, maxAge: 60 },
] as const;

/** Last 13 calendar months, newest first, as { id: 'YYYY-MM', label: 'Aug 2026' }. */
function recentMonths(): { id: string; label: string }[] {
    const out: { id: string; label: string }[] = [];
    const now = new Date();
    for (let i = 0; i < 13; i++) {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
        out.push({
            id: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
            label: d.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
        });
    }
    return out;
}

export default function LeadSourcesPage() {
    const { data: session } = useSession();
    const isAdmin = (session?.user as Record<string, unknown> | undefined)?.isAdmin === true;

    const months = useMemo(recentMonths, []);
    const [location, setLocation] = useState<LocationFilter>('all');
    const [mode, setMode] = useState<'rolling' | 'month' | 'range'>('rolling');
    const [cohort, setCohort] = useState<string>('30-90');
    const [month, setMonth] = useState<string>(months[1].id); // default to last full month
    const [from, setFrom] = useState<string>('');
    const [to, setTo] = useState<string>('');
    const [data, setData] = useState<Report | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        const params = new URLSearchParams({ maturation: '30' });
        if (mode === 'range') {
            if (!from || !to) { setLoading(false); return; }
            params.set('from', from);
            params.set('to', to);
        } else if (mode === 'month') {
            params.set('month', month);
        } else {
            const c = COHORTS.find(x => x.id === cohort) ?? COHORTS[0];
            params.set('minAge', String(c.minAge));
            params.set('maxAge', String(c.maxAge));
        }
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
    }, [location, cohort, mode, month, from, to]);

    useEffect(() => { load(); }, [load]);

    const activeCohort = COHORTS.find(x => x.id === cohort) ?? COHORTS[0];
    const activeMonth = months.find(m => m.id === month);
    const cohortLabel = mode === 'range'
        ? `leads submitted ${from} to ${to}`
        : mode === 'month'
            ? `leads submitted in ${activeMonth?.label ?? month}`
            : `leads ${activeCohort.label} old`;

    const totalPurchaseRate = data?.totals.newLeads
        ? (data.totals.purchased / data.totals.newLeads) * 100
        : null;
    // Maturity is a matter of degree, not a flag: a month whose leads are 96%
    // matured is worth reading, one at 40% is not. Suppress the banner entirely
    // once effectively everything has had its full window.
    const maturedPct = data ? Math.round(data.window.maturedShare * 100) : 100;
    const immature = data ? !data.window.matured && maturedPct < 100 : false;

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

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px', alignItems: 'center' }}>
                <span style={{ fontSize: '13px', opacity: 0.7 }}>Lead age:</span>
                {COHORTS.map(opt => (
                    <button
                        key={opt.id}
                        className={`period-btn ${mode === 'rolling' && cohort === opt.id ? 'active' : ''}`}
                        onClick={() => { setMode('rolling'); setCohort(opt.id); }}
                    >
                        {opt.label}
                    </button>
                ))}
                <span style={{ fontSize: '13px', opacity: 0.7, marginLeft: '12px' }}>Or by month:</span>
                <select
                    className={`period-btn ${mode === 'month' ? 'active' : ''}`}
                    value={mode === 'month' ? month : ''}
                    onChange={e => {
                        if (!e.target.value) return;
                        setMonth(e.target.value);
                        setMode('month');
                    }}
                >
                    <option value="">Select a month…</option>
                    {months.map(m => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                </select>
                <span style={{ fontSize: '13px', opacity: 0.7, marginLeft: '12px' }}>Or exact dates:</span>
                <input
                    type="date"
                    className={`period-btn ${mode === 'range' ? 'active' : ''}`}
                    value={from}
                    max={to || undefined}
                    onChange={e => { setFrom(e.target.value); if (e.target.value && to) setMode('range'); }}
                />
                <span style={{ fontSize: '13px', opacity: 0.7 }}>to</span>
                <input
                    type="date"
                    className={`period-btn ${mode === 'range' ? 'active' : ''}`}
                    value={to}
                    min={from || undefined}
                    onChange={e => { setTo(e.target.value); if (from && e.target.value) setMode('range'); }}
                />
            </div>

            {loading && <div className="section-card"><div className="empty-state">Loading…</div></div>}
            {error && <div className="section-card"><div className="empty-state">{error}</div></div>}

            {data && !loading && (
                <>
                    {immature && (
                        <div className="section-card" style={{ borderLeft: '3px solid var(--warning, #d6a44a)' }}>
                            <strong>
                                {maturedPct}% of these leads have had their full{' '}
                                {data.window.maturationDays} days to buy
                                {maturedPct >= 75 ? ' — read it, but the last few points will still move.' : ' — treat it as provisional.'}
                            </strong>
                            <p style={{ margin: '4px 0 0', fontSize: '14px', opacity: 0.85 }}>
                                The rest were submitted too recently, so the rates below can only go up. This
                                period is final on {data.window.maturesOn}. Median time from lead to first
                                purchase is 4 days and 92% of buyers buy within 30, so most of the movement
                                has already happened{maturedPct < 50 ? ' for the older half' : ''} — but put
                                against a finished period, a part-grown one still reads low.
                            </p>
                        </div>
                    )}

                    <div className="metrics-grid">
                        <div className="metric-card">
                            <div className="label">New leads</div>
                            <div className="value">{formatNumber(data.totals.newLeads)}</div>
                        </div>
                        <div className="metric-card">
                            <div className="label">Purchased</div>
                            <div className="value">{formatNumber(data.totals.purchased)}</div>
                        </div>
                        <div className="metric-card">
                            <div className="label">Purchase rate</div>
                            <div className="value">{totalPurchaseRate === null ? '—' : `${totalPurchaseRate.toFixed(0)}%`}</div>
                        </div>
                        {isAdmin && (
                            <div className="metric-card">
                                <div className="label">Revenue in {data.window.maturationDays}d</div>
                                <div className="value">{formatCurrency(data.totals.revenue ?? 0)}</div>
                            </div>
                        )}
                        {isAdmin && (
                            <div className="metric-card">
                                <div className="label">Revenue to date</div>
                                <div className="value">{formatCurrency(data.totals.revenueToDate ?? 0)}</div>
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
                                        <th style={{ textAlign: 'right' }}>Purchased</th>
                                        <th style={{ textAlign: 'right' }}>Purchase rate</th>
                                        {isAdmin && (
                                            <th style={{ textAlign: 'right' }} title={`Spend within ${data.window.maturationDays} days of the lead. Comparable between periods.`}>
                                                Revenue in {data.window.maturationDays}d
                                            </th>
                                        )}
                                        {isAdmin && (
                                            <th style={{ textAlign: 'right' }} title="Everything these leads have spent since. Truer, but older periods have had longer to accrue — do not compare across periods.">
                                                Revenue to date
                                            </th>
                                        )}
                                        {isAdmin && <th style={{ textAlign: 'right' }}>Rev / lead</th>}
                                        <th style={{ textAlign: 'right' }}>Existing patients</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.rows.map(r => (
                                        <tr key={r.channel}>
                                            <td>{r.channel}</td>
                                            <td style={{ textAlign: 'right' }}>{formatNumber(r.newLeads)}</td>
                                            <td style={{ textAlign: 'right' }}>{formatNumber(r.purchased)}</td>
                                            <td style={{ textAlign: 'right' }}>
                                                {r.purchaseRate === null ? (
                                                    <span
                                                        style={{ opacity: 0.5 }}
                                                        title={`n=${r.newLeads} — below the n=30 reporting threshold`}
                                                    >
                                                        n too small
                                                    </span>
                                                ) : `${(r.purchaseRate * 100).toFixed(0)}%`}
                                            </td>
                                            {isAdmin && (
                                                <td style={{ textAlign: 'right' }}>{formatCurrency(r.revenue ?? 0)}</td>
                                            )}
                                            {isAdmin && (
                                                <td style={{ textAlign: 'right' }}>{formatCurrency(r.revenueToDate ?? 0)}</td>
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
                                        <td style={{ textAlign: 'right' }}><strong>{formatNumber(data.totals.purchased)}</strong></td>
                                        <td style={{ textAlign: 'right' }}>
                                            <strong>{totalPurchaseRate === null ? '—' : `${totalPurchaseRate.toFixed(0)}%`}</strong>
                                        </td>
                                        {isAdmin && (
                                            <td style={{ textAlign: 'right' }}>
                                                <strong>{formatCurrency(data.totals.revenue ?? 0)}</strong>
                                            </td>
                                        )}
                                        {isAdmin && (
                                            <td style={{ textAlign: 'right' }}>
                                                <strong>{formatCurrency(data.totals.revenueToDate ?? 0)}</strong>
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
                                <strong>A conversion is a purchase, not an appointment.</strong> Anything the lead
                                bought counts, including retail. It comes from the same records as the revenue, so
                                the count and the dollars always agree.
                            </li>
                            <li>
                                <strong>Two revenue columns, and they answer different questions.</strong>{' '}
                                <em>Revenue in {data.window.maturationDays}d</em> gives every lead the same clock, so
                                periods can be compared. <em>Revenue to date</em> is the true total but keeps growing,
                                so an older period will always look better. Compare on the first; bank the second.
                            </li>
                            <li>
                                <strong>Revenue is associated, not caused.</strong> No holdout exists, so this ranks
                                sources — it does not prove one caused the return.
                            </li>
                            <li>
                                <strong>Cohort is {cohortLabel}.</strong>{' '}
                                {mode !== 'rolling'
                                    ? 'A lead counts in the period it was submitted, and its spending follows it there even if the sale happened later.'
                                    : 'Newer leads are excluded because they have not had time to convert and would drag their source down unfairly. These bounds are measured from today, so totals shift slightly between visits — pick a month if you need a figure that stays put.'}
                            </li>
                            <li>
                                <strong>Rows under 30 leads show no rate.</strong> The counts are too small to
                                support a percentage.
                            </li>
                            <li>
                                <strong>Only about 20% of leads can be matched to a patient record at all.</strong>{' '}
                                Matching needs a phone or email that appears in both systems, and an unmatchable
                                lead looks the same as one who never booked. Every rate here is a floor.
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
