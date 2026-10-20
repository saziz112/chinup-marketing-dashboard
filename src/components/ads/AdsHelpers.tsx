'use client';

import React, { useState } from 'react';
import { ChevronDown, Sparkles } from 'lucide-react';
import { fmt$, fmtNum, fmtPct } from '@/lib/format';
import { TOOLTIP_STYLE } from '@/lib/constants';
import { gradeMetric, gradeAllMetrics, overallGrade, getBenchmarkInfo, type MetricGrade } from '@/lib/ads-benchmarks';

// --- Types (shared with ads/page.tsx) ---

export interface Campaign {
    id: string;
    name: string;
    status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED' | 'DELETED';
    objective: string;
    spend: number | null;
    impressions: number;
    clicks: number;
    reach: number;
    frequency: number;
    cpm: number | null;
    cpc: number | null;
    ctr: number;
    results: number;
    costPerResult: number | null;
    roas: number;
    startTime: string;
    stopTime: string | null;
}

export interface CampaignBreakdown {
    id: string;
    name: string;
    status: string;
    spend: number;
    metaLeads: number;
    mbMatchedClients: number;
    matchedRevenue: number;
    trueRoas: number | null;
    matchRate: number | null;
    appointmentsBooked: number;
    appointmentsCompleted: number;
}

export interface RoasData {
    metaSpend: number;
    metaLeads: number;
    hasLeadForms: boolean;
    metaPlatformRoas: number;
    matchedClients: number;
    matchedRevenue: number;
    priorPatientRevenue: number;
    newPatientRevenue: number;
    newPatientRoas: number | null;
    topPatientRevenue: number;
    topPatientShare: number;
    unmatchedLeads: number;
    matchRate: number | null;
    trueRoas: number | null;
    costPerMatchedClient: number | null;
    attributionMethod: string;
    attributionNote: string;
    campaignBreakdown: CampaignBreakdown[];
    totalAppointmentsBooked: number;
    totalAppointmentsCompleted: number;
    matchedClientsDetails: {
        email: string;
        clientName: string;
        revenue: number;
        campaignId: string;
        campaignName: string;
        leadCost: number;
        isSplit?: boolean;
        ghlUrl?: string | null;
        ghlContactId?: string | null;
        mbClientId?: string | null;
    }[];
    isMock: boolean;
}

export type StatusFilter = 'ALL' | 'ACTIVE' | 'PAUSED';

// --- Helpers ---

export function objectiveLabel(obj: string): string {
    const map: Record<string, string> = {
        OUTCOME_LEADS: 'Leads',
        OUTCOME_AWARENESS: 'Awareness',
        OUTCOME_TRAFFIC: 'Traffic',
        OUTCOME_ENGAGEMENT: 'Engagement',
        OUTCOME_SALES: 'Sales',
        REACH: 'Reach',
        LINK_CLICKS: 'Link Clicks',
        LEAD_GENERATION: 'Lead Gen',
    };
    return map[obj] || obj.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

// --- Status Badge ---

export function StatusBadge({ status }: { status: Campaign['status'] }) {
    const map = {
        ACTIVE: { label: 'Active', color: '#22c55e' },
        PAUSED: { label: 'Paused', color: '#f59e0b' },
        ARCHIVED: { label: 'Archived', color: '#6b7280' },
        DELETED: { label: 'Deleted', color: '#ef4444' },
    };
    const cfg = map[status] || { label: status, color: '#6b7280' };
    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600,
            background: `${cfg.color}22`, color: cfg.color, whiteSpace: 'nowrap',
        }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: cfg.color, display: 'inline-block' }} />
            {cfg.label}
        </span>
    );
}

// --- Grade Dot (benchmark indicator) ---

export function GradeDot({ grade, showLabel }: { grade: MetricGrade | null; showLabel?: boolean }) {
    if (!grade) return null;
    return (
        <span title={grade.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{
                width: 8, height: 8, borderRadius: '50%', display: 'inline-block',
                background: grade.color, flexShrink: 0,
            }} />
            {showLabel && <span style={{ fontSize: 10, color: grade.color, fontWeight: 500 }}>{grade.label}</span>}
        </span>
    );
}

// --- Performance Summary Card ---

export function PerformanceSummary({ campaigns, platform, isAdmin }: {
    campaigns: Campaign[];
    platform: 'meta' | 'google';
    isAdmin: boolean;
}) {
    const activeCampaigns = campaigns.filter(c => c.status === 'ACTIVE' && (c.impressions > 0 || c.clicks > 0));
    if (activeCampaigns.length === 0) return null;

    const totalImpressions = activeCampaigns.reduce((s, c) => s + c.impressions, 0);
    const totalClicks = activeCampaigns.reduce((s, c) => s + c.clicks, 0);
    const totalSpend = activeCampaigns.reduce((s, c) => s + (c.spend || 0), 0);
    const totalResults = activeCampaigns.reduce((s, c) => s + c.results, 0);

    const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
    const avgCpm = totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0;
    const avgCpl = totalResults > 0 ? totalSpend / totalResults : 0;
    const avgRoas = activeCampaigns.reduce((s, c) => s + c.roas, 0) / activeCampaigns.length;

    const grades = gradeAllMetrics(
        { ctr: avgCtr, cpm: avgCpm, costPerResult: avgCpl, roas: avgRoas },
        platform,
    );
    const overall = overallGrade(grades);

    const metrics = [
        { key: 'ctr', label: 'CTR', value: `${avgCtr.toFixed(2)}%`, grade: grades.ctr, show: true },
        { key: 'cpm', label: 'CPM', value: `$${avgCpm.toFixed(0)}`, grade: grades.cpm, show: isAdmin },
        { key: 'costPerLead', label: 'Cost/Lead', value: `$${avgCpl.toFixed(0)}`, grade: grades.costPerLead, show: isAdmin },
        { key: 'roas', label: 'ROAS', value: `${avgRoas.toFixed(1)}x`, grade: grades.roas, show: true },
    ].filter(m => m.show);

    return (
        <div className="section-card bench-card" style={{ borderColor: `${overall.color}40` }}>
            <div className="bench-grade">
                <div className="letter" style={{ color: overall.color }}>{overall.letter}</div>
                <div className="cap">Overall</div>
            </div>
            <div className="bench-divider" />
            <div className="bench-metrics">
                {metrics.map(m => (
                    <div key={m.key} className="bench-metric">
                        <div className="v">
                            <span>{m.value}</span>
                            <GradeDot grade={m.grade} />
                        </div>
                        <div className="cap">{m.label}</div>
                        {m.grade && (
                            <div style={{ fontSize: 10, color: m.grade.color, fontWeight: 500 }}>{m.grade.label}</div>
                        )}
                    </div>
                ))}
            </div>
            <div className="bench-note">
                <div>vs. Med Spa Industry Avg</div>
                <div>{activeCampaigns.length} active campaign{activeCampaigns.length !== 1 ? 's' : ''}</div>
            </div>
        </div>
    );
}

// --- KPI Card ---

export function KpiCard({ label, value, sub, gold, green }: {
    label: string; value: string; sub?: string; gold?: boolean; green?: boolean;
}) {
    const tone = gold ? ' is-gold' : green ? ' is-green' : '';
    return (
        <div className={`metric-card${tone}`}>
            <div className="label">{label}</div>
            <div className="value">{value}</div>
            {sub && <div className="sub">{sub}</div>}
        </div>
    );
}

// --- True ROAS Banner (Admin only) ---

export function TrueRoasBanner({ roas, isMock, onOpenDetails }: { roas: RoasData; isMock: boolean; onOpenDetails: () => void }) {
    const noLeadForms = roas.attributionMethod === 'no_lead_forms';
    const outsideRetention = roas.attributionMethod === 'outside_lead_retention';
    const hasData = roas.trueRoas !== null;

    return (
        <div className={`section-card roas-banner${hasData ? ' is-clickable' : ''}`}
            onClick={hasData ? onOpenDetails : undefined}
            onKeyDown={hasData ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenDetails(); } } : undefined}
            role={hasData ? 'button' : undefined}
            tabIndex={hasData ? 0 : undefined}
        >
            <div className="roas-layout">
                <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                        <h3 style={{ margin: 0 }}>ROAS Reconciliation</h3>
                        {isMock && <span className="pill pill-warning">Demo</span>}
                        {!isMock && !noLeadForms && !outsideRetention && <span className="pill pill-success">Email-matched</span>}
                    </div>
                    <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0, lineHeight: 1.5, maxWidth: '60ch' }}>
                        {roas.attributionNote}
                        {hasData && <span style={{ color: 'var(--accent)', marginLeft: 8, fontWeight: 600, whiteSpace: 'nowrap' }}>View Details →</span>}
                    </p>
                </div>

                {noLeadForms ? (
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 300, textAlign: 'right', lineHeight: 1.5 }}>
                        Set up a <strong>Lead Generation</strong> campaign with a native Facebook form to enable email-level attribution.
                    </div>
                ) : outsideRetention ? null : (
                    <div className="roas-stats">
                        <div className="roas-col">
                            <div className="stat-label">True ROAS</div>
                            <div className="roas-big" style={{ color: roas.trueRoas !== null && roas.trueRoas > 0 ? 'var(--accent)' : 'var(--text-muted)' }}>
                                {roas.trueRoas !== null ? `${roas.trueRoas.toFixed(2)}x` : '\u2014'}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                {fmt$(roas.matchedRevenue)} rev {'\u00f7'} {fmt$(roas.metaSpend)} spend
                            </div>
                            {roas.matchedRevenue > 0 && (
                                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
                                    New patients only: {roas.newPatientRoas !== null ? `${roas.newPatientRoas.toFixed(2)}x` : '\u2014'} ({fmt$(roas.newPatientRevenue)})<br />
                                    Already patients: {fmt$(roas.priorPatientRevenue)}<br />
                                    Top patient: {fmt$(roas.topPatientRevenue)} ({Math.round(roas.topPatientShare * 100)}% of rev)
                                </div>
                            )}
                        </div>

                        <div className="roas-rule" />

                        <div className="roas-col">
                            <div className="stat-label">Meta ROAS</div>
                            <div className="roas-big" style={{ color: 'var(--text-secondary)' }}>
                                {roas.metaPlatformRoas !== null && roas.metaPlatformRoas > 0 ? `${roas.metaPlatformRoas.toFixed(2)}x` : '0.00x'}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Platform reported</div>
                        </div>

                        <div className="roas-rule" />

                        <div className="roas-facts">
                            <div style={{ fontSize: 12 }}>
                                <span style={{ color: 'var(--text-muted)' }}>Meta Leads: </span>
                                <span style={{ fontWeight: 600 }}>{roas.metaLeads}</span>
                            </div>
                            <div style={{ fontSize: 12 }}>
                                <span style={{ color: 'var(--text-muted)' }}>Paying patients: </span>
                                <span style={{ fontWeight: 600, color: 'var(--success)' }}>{roas.matchedClients}</span>
                            </div>
                            <div style={{ fontSize: 12 }}>
                                <span style={{ color: 'var(--text-muted)' }}>Match Rate: </span>
                                <span style={{ fontWeight: 600 }}>{roas.matchRate !== null ? `${roas.matchRate}%` : '\u2014'}</span>
                            </div>
                            <div style={{ fontSize: 12 }}>
                                <span style={{ color: 'var(--text-muted)' }}>Cost/Paying patient: </span>
                                <span style={{ fontWeight: 600 }}>{fmt$(roas.costPerMatchedClient)}</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

// --- Campaigns Table ---

export function CampaignsTable({ campaigns, roasDict, isAdmin, statusFilter, onStatusFilter, isOverview, isGoogle, onAnalyze, aiAnalysis, aiExpanded, onToggleAI, aiLoading }: {
    campaigns: (Campaign & { platform?: string })[];
    roasDict?: Record<string, CampaignBreakdown>;
    isAdmin: boolean;
    statusFilter: StatusFilter;
    onStatusFilter: (f: StatusFilter) => void;
    isOverview?: boolean;
    isGoogle?: boolean;
    onAnalyze?: (campaign: Campaign) => void;
    aiAnalysis?: Record<string, { grade: string; summary: string; priorityActions: string[]; creativeSuggestion: string | null }>;
    aiExpanded?: Set<string>;
    onToggleAI?: (id: string) => void;
    aiLoading?: string | null;
}) {
    const [sortBy, setSortBy] = useState<string>('results');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

    const sort = (col: string) => {
        if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortBy(col); setSortDir('desc'); }
    };

    const getValue = (c: Campaign, col: string): number => {
        if (col === 'trueRoas') return roasDict?.[c.id]?.trueRoas ?? -1;
        if (col === 'mbClients') return roasDict?.[c.id]?.mbMatchedClients ?? -1;
        if (col === 'apptsBooked') return roasDict?.[c.id]?.appointmentsBooked ?? -1;
        if (col === 'apptsCompleted') return roasDict?.[c.id]?.appointmentsCompleted ?? -1;
        return (c as any)[col] ?? -1;
    };

    const filtered = campaigns.filter(c => {
        if (statusFilter === 'ALL') return true;
        return c.status === statusFilter;
    });

    const sorted = [...filtered].sort((a, b) => {
        const av = getValue(a, sortBy);
        const bv = getValue(b, sortBy);
        const cmp = av > bv ? 1 : av < bv ? -1 : 0;
        return sortDir === 'asc' ? cmp : -cmp;
    });

    const Th = ({ label, col }: { label: string; col?: string }) => (
        <th onClick={col ? () => sort(col) : undefined}
            style={{ cursor: col ? 'pointer' : 'default', userSelect: 'none', whiteSpace: 'nowrap' }}>
            {label}{col && sortBy === col ? (sortDir === 'desc' ? ' \u2193' : ' \u2191') : ''}
        </th>
    );

    const counts = {
        ALL: campaigns.length,
        ACTIVE: campaigns.filter(c => c.status === 'ACTIVE').length,
        PAUSED: campaigns.filter(c => c.status === 'PAUSED').length,
    };

    return (
        <>
            <div className="chip-row" role="group" aria-label="Filter campaigns by status">
                {(['ACTIVE', 'PAUSED', 'ALL'] as StatusFilter[]).map(f => (
                    <button key={f} onClick={() => onStatusFilter(f)} aria-pressed={statusFilter === f}
                        className={`chip${statusFilter === f ? ` on-${f.toLowerCase()}` : ''}`}>
                        {f === 'ALL' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase()} ({counts[f]})
                    </button>
                ))}
            </div>

            {sorted.length === 0 ? (
                <div className="empty-state">
                    <h3>No {statusFilter !== 'ALL' ? statusFilter.toLowerCase() : ''} campaigns</h3>
                    <p>Try changing the filter or selecting a wider date range.</p>
                </div>
            ) : (
                <div style={{ overflowX: 'auto' }}>
                    <div className="data-table-wrapper"><table className="data-table sticky-first">
                        <thead>
                            <tr>
                                <Th label="Campaign" col="name" />
                                {isOverview && <Th label="Platform" col="platform" />}
                                <Th label="Status" col="status" />
                                <Th label="Objective" />
                                {isAdmin && <Th label="Spend" col="spend" />}
                                <Th label="Impressions" col="impressions" />
                                <Th label="Clicks" col="clicks" />
                                <Th label="CTR" col="ctr" />
                                {isAdmin && <Th label="CPM" col="cpm" />}
                                <Th label="Leads" col="results" />
                                {isAdmin && <Th label="Cost/Lead" col="costPerResult" />}
                                {isAdmin && !!roasDict && <Th label="MB Clients" col="mbClients" />}
                                {isAdmin && !!roasDict && <Th label="Booked" col="apptsBooked" />}
                                {isAdmin && !!roasDict && <Th label="Completed" col="apptsCompleted" />}
                                <Th label={isAdmin && !!roasDict ? "True ROAS" : "ROAS"} col={isAdmin && !!roasDict ? "trueRoas" : "roas"} />
                                {!!onAnalyze && <th style={{ width: 40 }} />}
                            </tr>
                        </thead>
                        <tbody>
                            {sorted.map(c => {
                                const breakdown = roasDict?.[c.id];
                                const hasTrueRoas = breakdown?.trueRoas !== undefined && breakdown?.trueRoas !== null;
                                const roasVal = hasTrueRoas ? breakdown!.trueRoas! : c.roas;

                                const plat: 'meta' | 'google' = isOverview
                                    ? (c.platform === 'Google Ads' ? 'google' : 'meta')
                                    : (isGoogle ? 'google' : 'meta');
                                const cGrades = c.impressions > 0
                                    ? gradeAllMetrics({ ctr: c.ctr, cpm: c.cpm, costPerResult: c.costPerResult, roas: c.roas }, plat)
                                    : {} as Record<string, MetricGrade | null>;

                                return (
                                    <React.Fragment key={c.id}>
                                    <tr>
                                        <td title={c.name} style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>{c.name}</td>
                                        {isOverview && (
                                            <td>
                                                <span style={{ fontSize: 11, fontWeight: 600, color: c.platform === 'Google Ads' ? '#EA4335' : 'var(--accent)', padding: '2px 6px', borderRadius: 4, background: c.platform === 'Google Ads' ? '#EA433522' : 'var(--accent-bg)' }}>
                                                    {c.platform === 'Google Ads' ? 'Google' : 'Meta'}
                                                </span>
                                            </td>
                                        )}
                                        <td><StatusBadge status={c.status} /></td>
                                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{objectiveLabel(c.objective)}</td>
                                        {isAdmin && <td style={{ color: 'var(--accent)', fontWeight: 600 }}>{fmt$(c.spend)}</td>}
                                        <td>{fmtNum(c.impressions)}</td>
                                        <td>{fmtNum(c.clicks)}</td>
                                        <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{fmtPct(c.ctr)} <GradeDot grade={cGrades.ctr ?? null} /></span></td>
                                        {isAdmin && <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{fmt$(c.cpm)} <GradeDot grade={cGrades.cpm ?? null} /></span></td>}
                                        <td style={{ fontWeight: 600 }}>{fmtNum(c.results)}</td>
                                        {isAdmin && <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{fmt$(c.costPerResult)} <GradeDot grade={cGrades.costPerLead ?? null} /></span></td>}
                                        {isAdmin && !!roasDict && (
                                            <td style={{ fontWeight: 600, color: (breakdown?.mbMatchedClients || 0) > 0 ? '#22c55e' : 'var(--text-muted)' }}>
                                                {breakdown?.mbMatchedClients || '0'}
                                            </td>
                                        )}
                                        {isAdmin && !!roasDict && (
                                            <td style={{ color: (breakdown?.appointmentsBooked || 0) > 0 ? '#60a5fa' : 'var(--text-muted)' }}>
                                                {breakdown?.appointmentsBooked || '0'}
                                            </td>
                                        )}
                                        {isAdmin && !!roasDict && (
                                            <td style={{ fontWeight: 600, color: (breakdown?.appointmentsCompleted || 0) > 0 ? '#22c55e' : 'var(--text-muted)' }}>
                                                {breakdown?.appointmentsCompleted || '0'}
                                            </td>
                                        )}
                                        <td style={{ color: roasVal > 0 ? '#22c55e' : 'var(--text-muted)', fontWeight: 600 }}>
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                                {roasVal !== null && roasVal !== undefined ? `${roasVal.toFixed(1)}x` : '\u2014'}
                                                <GradeDot grade={gradeMetric('roas', roasVal ?? c.roas, plat)} />
                                            </span>
                                        </td>
                                        {!!onAnalyze && (
                                            <td>
                                                <button
                                                    onClick={() => {
                                                        if (aiAnalysis?.[c.id]) {
                                                            if (onToggleAI) onToggleAI(c.id);
                                                        } else {
                                                            onAnalyze(c);
                                                        }
                                                    }}
                                                    disabled={aiLoading === c.id}
                                                    title={aiAnalysis?.[c.id] ? (aiExpanded?.has(c.id) ? 'Collapse analysis' : 'Show analysis') : 'AI Campaign Analysis'}
                                                    aria-label={aiAnalysis?.[c.id] ? (aiExpanded?.has(c.id) ? 'Collapse analysis' : 'Show analysis') : 'AI Campaign Analysis'}
                                                    style={{
                                                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                                        width: 36, height: 36,
                                                        background: aiExpanded?.has(c.id) ? 'var(--accent-bg)' : 'transparent',
                                                        border: `1px solid ${aiAnalysis?.[c.id] ? 'rgba(216,180,29,0.4)' : 'var(--border)'}`,
                                                        borderRadius: 8, cursor: 'pointer',
                                                        color: aiAnalysis?.[c.id] ? 'var(--accent)' : 'var(--text-muted)',
                                                    }}
                                                >
                                                    {aiLoading === c.id ? <span className="loading-caption" style={{ margin: 0 }} /> : aiExpanded?.has(c.id) ? <ChevronDown size={16} aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}
                                                </button>
                                            </td>
                                        )}
                                    </tr>
                                    {aiAnalysis?.[c.id] && aiExpanded?.has(c.id) && (
                                        <tr>
                                            <td colSpan={20} style={{ padding: 0, border: 'none' }}>
                                                <div style={{
                                                    background: 'rgba(216,180,29,0.04)',
                                                    borderTop: '1px solid rgba(216,180,29,0.2)',
                                                    borderBottom: '1px solid var(--border-subtle)',
                                                    padding: '14px 16px', fontSize: 13,
                                                }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                                                        <span style={{
                                                            fontSize: 20, fontWeight: 700, lineHeight: 1,
                                                            color: { A: '#22c55e', B: '#86efac', C: '#f59e0b', D: '#fb923c', F: '#ef4444' }[aiAnalysis[c.id].grade] || '#6b7280',
                                                        }}>
                                                            {aiAnalysis[c.id].grade}
                                                        </span>
                                                        <span style={{ color: 'var(--text-secondary)' }}>{aiAnalysis[c.id].summary}</span>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                                                        <div style={{ flex: 1, minWidth: 'min(250px, 100%)' }}>
                                                            <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>Priority Actions</div>
                                                            <ul style={{ margin: 0, paddingLeft: 16, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                                                                {aiAnalysis[c.id].priorityActions.map((a, i) => (
                                                                    <li key={i}>{a}</li>
                                                                ))}
                                                            </ul>
                                                        </div>
                                                        {aiAnalysis[c.id].creativeSuggestion && (
                                                            <div style={{ flex: 1, minWidth: 'min(250px, 100%)' }}>
                                                                <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>Creative Suggestion</div>
                                                                <p style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{aiAnalysis[c.id].creativeSuggestion}</p>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table></div>
                </div>
            )}
        </>
    );
}

// --- Chart Tooltip ---

export function CustomTooltip({ active, payload, label, isAdmin }: {
    active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string; isAdmin: boolean;
}) {
    if (!active || !payload?.length) return null;
    return (
        <div style={{ ...TOOLTIP_STYLE, fontSize: 12, padding: '10px 14px' }}>
            <p style={{ color: 'var(--text-muted)', marginBottom: 6 }}>{label}</p>
            {payload.map(p => (
                <p key={p.name} style={{ color: p.color }}>
                    {p.name}: {p.name === 'Spend' ? (isAdmin ? `$${p.value.toFixed(0)}` : '\u2014') : fmtNum(p.value)}
                </p>
            ))}
        </div>
    );
}
