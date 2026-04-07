'use client';

import React from 'react';
import { useSession } from 'next-auth/react';
import { useState, useEffect, useCallback } from 'react';
import {
    AreaChart, Area, BarChart, Bar,
    XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, Legend,
} from 'recharts';
import { format, parseISO, subDays } from 'date-fns';
import { DateRangePicker } from '@/components/DateRangePicker';
import { SkeletonKpiCard, SkeletonChart, SkeletonTable } from '@/components/Skeleton';
import { gradeMetric, gradeAllMetrics, overallGrade, getBenchmarkInfo, type MetricGrade } from '@/lib/ads-benchmarks';

// --- Types ---

interface Campaign {
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

interface DailySpend {
    date: string;
    spend: number | null;
    impressions: number;
    clicks: number;
    results: number;
}

interface AccountSummary {
    id: string;
    name: string;
    currency: string;
    timezone: string;
    accountStatus: number;
    totalSpend: number | null;
    totalImpressions: number;
    totalClicks: number;
    totalReach: number;
    totalResults: number;
}

interface AdsData {
    isConfigured: boolean;
    isMock: boolean;
    account: AccountSummary;
    campaigns: Campaign[];
    dailySpend: DailySpend[];
}

interface OverviewData {
    isConfigured: { meta: boolean; google: boolean };
    isMock: boolean;
    account: AccountSummary;
    campaigns: (Campaign & { platform: string })[];
    dailySpend: (DailySpend & { metaSpend: number | null; googleSpend: number | null; metaLeads: number; googleLeads: number; totalSpend: number | null; totalLeads: number })[];
}

interface CampaignBreakdown {
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

interface RoasData {
    metaSpend: number;
    metaLeads: number;
    hasLeadForms: boolean;
    metaPlatformRoas: number;
    matchedClients: number;
    matchedRevenue: number;
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
    }[];
    isMock: boolean;
}

// --- Constants ---

const TABS = ['Overview', 'Meta Ads', 'Google Ads'] as const;
type Tab = typeof TABS[number];

type StatusFilter = 'ALL' | 'ACTIVE' | 'PAUSED';

// --- Helpers ---

function fmt$(n: number | null | undefined, currency = 'USD'): string {
    if (n === null || n === undefined) return '—';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

function fmtNum(n: number | undefined, decimals = 0): string {
    if (n === undefined || n === null) return '—';
    return n.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fmtPct(n: number | undefined): string {
    if (n === undefined || n === null) return '—';
    return n.toFixed(2) + '%';
}

function objectiveLabel(obj: string): string {
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

function StatusBadge({ status }: { status: Campaign['status'] }) {
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

function GradeDot({ grade, showLabel }: { grade: MetricGrade | null; showLabel?: boolean }) {
    if (!grade) return null;
    const info = getBenchmarkInfo;
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

function PerformanceSummary({ campaigns, platform, isAdmin }: {
    campaigns: Campaign[];
    platform: 'meta' | 'google';
    isAdmin: boolean;
}) {
    const activeCampaigns = campaigns.filter(c => c.status === 'ACTIVE' && (c.impressions > 0 || c.clicks > 0));
    if (activeCampaigns.length === 0) return null;

    // Aggregate metrics across active campaigns
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
        <div className="section-card" style={{
            marginBottom: 24, display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap',
            background: 'linear-gradient(135deg, rgba(99,102,241,0.06) 0%, rgba(34,197,94,0.04) 100%)',
            border: `1px solid ${overall.color}33`,
        }}>
            <div style={{ textAlign: 'center', minWidth: 70 }}>
                <div style={{ fontSize: 36, fontWeight: 700, color: overall.color, lineHeight: 1 }}>{overall.letter}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Overall</div>
            </div>
            <div style={{ width: 1, height: 48, background: 'var(--border)' }} />
            {metrics.map(m => (
                <div key={m.key} style={{ textAlign: 'center', minWidth: 80 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                        <span style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)' }}>{m.value}</span>
                        <GradeDot grade={m.grade} />
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{m.label}</div>
                    {m.grade && (
                        <div style={{ fontSize: 10, color: m.grade.color, fontWeight: 500 }}>{m.grade.label}</div>
                    )}
                </div>
            ))}
            <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>
                <div>vs. Med Spa Industry Avg</div>
                <div>{activeCampaigns.length} active campaign{activeCampaigns.length !== 1 ? 's' : ''}</div>
            </div>
        </div>
    );
}

// --- KPI Card ---

function KpiCard({ label, value, sub, gold, green }: {
    label: string; value: string; sub?: string; gold?: boolean; green?: boolean;
}) {
    const accent = gold ? 'var(--accent)' : green ? '#22c55e' : undefined;
    return (
        <div className="metric-card" style={accent ? { borderColor: accent, boxShadow: `0 0 0 1px ${accent}33` } : {}}>
            <div className="label">{label}</div>
            <div className="value" style={accent ? { color: accent } : {}}>{value}</div>
            {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{sub}</div>}
        </div>
    );
}

// --- True ROAS Banner (Admin only) ---

function TrueRoasBanner({ roas, isMock, onOpenDetails }: { roas: RoasData; isMock: boolean; onOpenDetails: () => void }) {
    const noLeadForms = roas.attributionMethod === 'no_lead_forms';
    const hasData = roas.trueRoas !== null;

    return (
        <div className="section-card"
            style={{
                background: 'linear-gradient(135deg, rgba(216,180,29,0.08) 0%, rgba(34,197,94,0.06) 100%)',
                border: '1px solid rgba(216,180,29,0.25)',
                marginBottom: 24,
                cursor: hasData ? 'pointer' : 'default',
                transition: 'all 0.2s ease'
            }}
            onClick={hasData ? onOpenDetails : undefined}
            onMouseEnter={(e) => { if (hasData) e.currentTarget.style.transform = 'translateY(-2px)'; }}
            onMouseLeave={(e) => { if (hasData) e.currentTarget.style.transform = 'translateY(0)'; }}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
                <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <h3 style={{ margin: 0 }}>ROAS Reconciliation</h3>
                        {isMock && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#f59e0b22', color: '#f59e0b', border: '1px solid #f59e0b44' }}>Demo</span>}
                        {!isMock && !noLeadForms && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#22c55e22', color: '#22c55e', border: '1px solid #22c55e44' }}>Email-matched</span>}
                    </div>
                    <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
                        {roas.attributionNote}
                        {hasData && <span style={{ color: 'var(--accent)', marginLeft: 8, fontWeight: 500 }}>View Details →</span>}
                    </p>
                </div>

                {noLeadForms ? (
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 300, textAlign: 'right', lineHeight: 1.5 }}>
                        Set up a <strong>Lead Generation</strong> campaign with a native Facebook form to enable email-level attribution.
                    </div>
                ) : (
                    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                        {/* True ROAS */}
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>True ROAS</div>
                            <div style={{ fontSize: 28, fontWeight: 700, color: roas.trueRoas !== null && roas.trueRoas > 0 ? 'var(--accent)' : 'var(--text-muted)' }}>
                                {roas.trueRoas !== null ? `${roas.trueRoas.toFixed(2)}x` : '—'}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                {fmt$(roas.matchedRevenue)} rev ÷ {fmt$(roas.metaSpend)} spend
                            </div>
                        </div>

                        <div style={{ width: 1, background: 'var(--border)' }} />

                        {/* Meta ROAS */}
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Meta ROAS</div>
                            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-secondary)' }}>
                                {roas.metaPlatformRoas !== null && roas.metaPlatformRoas > 0 ? `${roas.metaPlatformRoas.toFixed(2)}x` : '0.00x'}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Platform reported</div>
                        </div>

                        <div style={{ width: 1, background: 'var(--border)' }} />

                        {/* Stats */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, justifyContent: 'center' }}>
                            <div style={{ fontSize: 12 }}>
                                <span style={{ color: 'var(--text-muted)' }}>Meta Leads: </span>
                                <span style={{ fontWeight: 600 }}>{roas.metaLeads}</span>
                            </div>
                            <div style={{ fontSize: 12 }}>
                                <span style={{ color: 'var(--text-muted)' }}>Matched to MB: </span>
                                <span style={{ fontWeight: 600, color: '#22c55e' }}>{roas.matchedClients}</span>
                            </div>
                            <div style={{ fontSize: 12 }}>
                                <span style={{ color: 'var(--text-muted)' }}>Match Rate: </span>
                                <span style={{ fontWeight: 600 }}>{roas.matchRate !== null ? `${roas.matchRate}%` : '—'}</span>
                            </div>
                            <div style={{ fontSize: 12 }}>
                                <span style={{ color: 'var(--text-muted)' }}>Cost/Client: </span>
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

function CampaignsTable({ campaigns, roasDict, isAdmin, statusFilter, onStatusFilter, isOverview, isGoogle, onAnalyze, aiAnalysis, aiExpanded, onToggleAI, aiLoading }: {
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
        if (col === 'trueRoas') {
            return roasDict?.[c.id]?.trueRoas ?? -1;
        }
        if (col === 'mbClients') {
            return roasDict?.[c.id]?.mbMatchedClients ?? -1;
        }
        if (col === 'apptsBooked') {
            return roasDict?.[c.id]?.appointmentsBooked ?? -1;
        }
        if (col === 'apptsCompleted') {
            return roasDict?.[c.id]?.appointmentsCompleted ?? -1;
        }
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
            {label}{col && sortBy === col ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
        </th>
    );

    const counts = {
        ALL: campaigns.length,
        ACTIVE: campaigns.filter(c => c.status === 'ACTIVE').length,
        PAUSED: campaigns.filter(c => c.status === 'PAUSED').length,
    };

    return (
        <>
            {/* Status filter tabs */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                {(['ACTIVE', 'PAUSED', 'ALL'] as StatusFilter[]).map(f => (
                    <button key={f} onClick={() => onStatusFilter(f)}
                        style={{
                            padding: '4px 12px', borderRadius: 999, fontSize: 12, fontWeight: 500,
                            background: statusFilter === f ? (f === 'ACTIVE' ? '#22c55e22' : f === 'PAUSED' ? '#f59e0b22' : 'rgba(255,255,255,0.1)') : 'transparent',
                            color: statusFilter === f ? (f === 'ACTIVE' ? '#22c55e' : f === 'PAUSED' ? '#f59e0b' : '#fff') : 'var(--text-muted)',
                            border: `1px solid ${statusFilter === f ? (f === 'ACTIVE' ? '#22c55e44' : f === 'PAUSED' ? '#f59e0b44' : 'rgba(255,255,255,0.2)') : 'var(--border)'}`,
                            cursor: 'pointer',
                        }}>
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
                    <div className="data-table-wrapper"><table className="data-table">
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
                                        <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</td>
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
                                                {roasVal !== null && roasVal !== undefined ? `${roasVal.toFixed(1)}x` : '—'}
                                                <GradeDot grade={gradeMetric('roas', roasVal ?? c.roas, plat)} />
                                            </span>
                                        </td>
                                        {!!onAnalyze && (
                                            <td>
                                                <button
                                                    onClick={() => {
                                                        if (aiAnalysis?.[c.id]) {
                                                            // Toggle expand/collapse
                                                            if (onToggleAI) onToggleAI(c.id);
                                                        } else {
                                                            // Fetch analysis and auto-expand
                                                            onAnalyze(c);
                                                        }
                                                    }}
                                                    disabled={aiLoading === c.id}
                                                    title={aiAnalysis?.[c.id] ? (aiExpanded?.has(c.id) ? 'Collapse analysis' : 'Show analysis') : 'AI Campaign Analysis'}
                                                    style={{
                                                        background: aiExpanded?.has(c.id) ? '#6366f122' : 'transparent',
                                                        border: `1px solid ${aiAnalysis?.[c.id] ? '#6366f144' : 'var(--border)'}`,
                                                        borderRadius: 6, padding: '4px 8px', cursor: 'pointer',
                                                        color: aiAnalysis?.[c.id] ? '#a5b4fc' : 'var(--text-muted)',
                                                        fontSize: 14, lineHeight: 1,
                                                    }}
                                                >
                                                    {aiLoading === c.id ? '...' : aiExpanded?.has(c.id) ? '▼' : '✨'}
                                                </button>
                                            </td>
                                        )}
                                    </tr>
                                    {/* AI Analysis expandable row */}
                                    {aiAnalysis?.[c.id] && aiExpanded?.has(c.id) && (
                                        <tr>
                                            <td colSpan={20} style={{ padding: 0, border: 'none' }}>
                                                <div style={{
                                                    background: 'linear-gradient(135deg, rgba(99,102,241,0.06) 0%, rgba(34,197,94,0.04) 100%)',
                                                    borderTop: '1px solid #6366f133',
                                                    padding: '12px 16px', fontSize: 13,
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
                                                        <div style={{ flex: 1, minWidth: 250 }}>
                                                            <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>Priority Actions</div>
                                                            <ul style={{ margin: 0, paddingLeft: 16, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                                                                {aiAnalysis[c.id].priorityActions.map((a, i) => (
                                                                    <li key={i}>{a}</li>
                                                                ))}
                                                            </ul>
                                                        </div>
                                                        {aiAnalysis[c.id].creativeSuggestion && (
                                                            <div style={{ flex: 1, minWidth: 250 }}>
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

function CustomTooltip({ active, payload, label, isAdmin }: {
    active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string; isAdmin: boolean;
}) {
    if (!active || !payload?.length) return null;
    return (
        <div style={{ background: '#1a2332', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>
            <p style={{ color: 'var(--text-muted)', marginBottom: 6 }}>{label}</p>
            {payload.map(p => (
                <p key={p.name} style={{ color: p.color }}>
                    {p.name}: {p.name === 'Spend' ? (isAdmin ? `$${p.value.toFixed(0)}` : '—') : fmtNum(p.value)}
                </p>
            ))}
        </div>
    );
}

// --- Main Page ---

export default function AdsPage() {
    const { data: session } = useSession();
    const [activeTab, setActiveTab] = useState<Tab>('Overview');
    const [since, setSince] = useState(() => format(subDays(new Date(), 29), 'yyyy-MM-dd'));
    const [until, setUntil] = useState(() => format(new Date(), 'yyyy-MM-dd'));
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('ACTIVE');
    const [metaData, setMetaData] = useState<AdsData | null>(null);
    const [googleData, setGoogleData] = useState<AdsData | null>(null);
    const [overviewData, setOverviewData] = useState<OverviewData | null>(null);
    const [roasData, setRoasData] = useState<RoasData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showRoasModal, setShowRoasModal] = useState(false);
    const [aiAnalysis, setAiAnalysis] = useState<Record<string, { grade: string; summary: string; priorityActions: string[]; creativeSuggestion: string | null }>>({});
    const [aiExpanded, setAiExpanded] = useState<Set<string>>(new Set()); // which AI rows are visible
    const [aiLoading, setAiLoading] = useState<string | null>(null); // campaignId currently loading
    const [creativesData, setCreativesData] = useState<Record<string, Array<{ title: string | null; body: string | null }>>>({});

    const user = session?.user as Record<string, unknown> | undefined;
    const isAdmin = user?.isAdmin === true;

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const params = `since=${since}&until=${until}`;
            const isGoogle = activeTab === 'Google Ads';
            const isOverview = activeTab === 'Overview';

            // Clear stale ROAS when not on Meta tab
            if (isOverview || isGoogle) {
                setRoasData(null);
            }

            if (isOverview) {
                const res = await fetch(`/api/paid-ads/overview?${params}`);
                if (!res.ok) throw new Error(`Overview API: HTTP ${res.status}`);
                const mainJson = await res.json();
                if (mainJson.error) throw new Error(mainJson.error);
                setOverviewData(mainJson as OverviewData);
            } else {
                const requests: Promise<Response>[] = [
                    isGoogle ? fetch(`/api/paid-ads/google?${params}`) : fetch(`/api/paid-ads/meta?${params}`)
                ];

                if (isAdmin && !isGoogle) {
                    requests.push(fetch(`/api/paid-ads/roas?${params}`));
                }

                const results = await Promise.all(requests);
                if (!results[0].ok) throw new Error(`${isGoogle ? 'Google' : 'Meta'} Ads API: HTTP ${results[0].status}`);
                const mainJson = await results[0].json();
                if (mainJson.error) throw new Error(mainJson.error);

                if (isGoogle) {
                    setGoogleData(mainJson as AdsData);
                } else {
                    setMetaData(mainJson as AdsData);
                }

                if (!isGoogle && results[1] && results[1].ok) {
                    const roasJson = await results[1].json();
                    if (!roasJson.error) setRoasData(roasJson as RoasData);
                }
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load data');
        } finally {
            setLoading(false);
        }
    }, [since, until, isAdmin, activeTab]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const data = activeTab === 'Overview' ? overviewData : (activeTab === 'Google Ads' ? googleData : metaData);

    const acc = data?.account;
    const campaigns = data?.campaigns || [];
    const dailySpend = data?.dailySpend || [];

    const isOverview = activeTab === 'Overview';
    const isGoogle = activeTab === 'Google Ads';
    const isMeta = activeTab === 'Meta Ads';

    const overallCtr = acc && acc.totalClicks > 0 && acc.totalImpressions > 0
        ? (acc.totalClicks / acc.totalImpressions * 100) : 0;

    // Bar chart data — respects status filter
    const filteredForChart = statusFilter === 'ALL'
        ? campaigns
        : campaigns.filter(c => c.status === statusFilter);

    // Dictionary for fast campaign lookups
    const roasDict = roasData?.campaignBreakdown.reduce((acc, b) => {
        acc[b.id] = b;
        return acc;
    }, {} as Record<string, CampaignBreakdown>);

    const chartData = dailySpend.map(d => {
        if (isOverview) {
            const od = d as any;
            return {
                date: format(parseISO(od.date), 'MMM d'),
                "Meta Spend": od.metaSpend ?? 0,
                "Google Spend": od.googleSpend ?? 0,
                Spend: od.totalSpend ?? 0,
                Clicks: od.clicks,
                Leads: od.results ?? od.totalLeads ?? 0,
            };
        }
        return {
            date: format(parseISO(d.date), 'MMM d'),
            Spend: d.spend ?? 0,
            Clicks: d.clicks,
            Leads: d.results,
        };
    });

    const periodLabel = `${format(parseISO(since), 'MMM d, yyyy')} - ${format(parseISO(until), 'MMM d, yyyy')}`;

    // Fetch ad creatives when switching to Meta/Google tab
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (isOverview || !data) return;
        const plat = isGoogle ? 'google' : 'meta';
        fetch(`/api/paid-ads/creatives?since=${since}&until=${until}&platform=${plat}`)
            .then(r => r.json())
            .then(d => { if (d.creatives) setCreativesData(d.creatives); })
            .catch(() => {});
    }, [since, until, activeTab, isOverview, isGoogle]); // eslint-disable-line react-hooks/exhaustive-deps

    const analyzeWithAI = async (campaign: Campaign) => {
        const platform = isGoogle ? 'google' : 'meta';
        setAiLoading(campaign.id);
        try {
            const grades = gradeAllMetrics(
                { ctr: campaign.ctr, cpm: campaign.cpm, costPerResult: campaign.costPerResult, roas: campaign.roas },
                platform as 'meta' | 'google',
            );
            const benchmarkGrades: Record<string, { grade: string; label: string }> = {};
            for (const [k, v] of Object.entries(grades)) {
                if (v) benchmarkGrades[k] = { grade: v.grade, label: v.label };
            }

            const creatives = creativesData[campaign.id];
            const adCopy = creatives?.[0] ? { title: creatives[0].title, body: creatives[0].body } : null;

            const breakdown = roasData?.campaignBreakdown.find(b => b.id === campaign.id);
            const appointmentData = breakdown && (breakdown.appointmentsBooked > 0 || breakdown.appointmentsCompleted > 0)
                ? { booked: breakdown.appointmentsBooked, completed: breakdown.appointmentsCompleted }
                : null;

            const res = await fetch('/api/paid-ads/ai-analysis', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    campaignName: campaign.name,
                    platform,
                    metrics: {
                        ctr: campaign.ctr, cpm: campaign.cpm, cpc: campaign.cpc,
                        costPerResult: campaign.costPerResult, roas: campaign.roas,
                        impressions: campaign.impressions, clicks: campaign.clicks,
                        results: campaign.results, spend: campaign.spend,
                    },
                    benchmarkGrades,
                    adCopy,
                    appointmentData,
                }),
            });
            const result = await res.json();
            if (!res.ok) throw new Error(result.error);
            setAiAnalysis(prev => ({ ...prev, [campaign.id]: result }));
            setAiExpanded(prev => new Set(prev).add(campaign.id));
        } catch (e) {
            console.error('AI analysis failed:', e);
        } finally {
            setAiLoading(null);
        }
    };

    return (
        <>
            <div className="page-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <h1>Paid Ads</h1>
                    {data?.isMock && (
                        <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: '#f59e0b22', color: '#f59e0b', border: '1px solid #f59e0b44' }}>Demo Data</span>
                    )}
                    {data?.isConfigured && !data.isMock && (
                        <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: '#22c55e22', color: '#22c55e', border: '1px solid #22c55e44' }}>Live</span>
                    )}
                </div>
                <p className="subtitle">Campaign performance and ROI across ad platforms</p>
            </div>

            {/* Tab + Period Controls */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
                <div className="sub-tabs">
                    {TABS.map(tab => (
                        <button key={tab} className={`sub-tab ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>{tab}</button>
                    ))}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <DateRangePicker
                        since={since}
                        until={until}
                        onChange={(newSince, newUntil) => {
                            setSince(newSince);
                            setUntil(newUntil);
                        }}
                    />
                </div>
            </div>

            {loading && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                    <div className="metrics-grid">
                        <SkeletonKpiCard />
                        <SkeletonKpiCard />
                        <SkeletonKpiCard />
                        <SkeletonKpiCard />
                    </div>
                    <SkeletonChart height={240} />
                    <SkeletonTable rows={4} />
                </div>
            )}

            {error && !loading && (
                <div className="section-card" style={{ border: '1px solid #ef444444', background: 'rgba(239, 68, 68, 0.05)' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                        <span style={{ fontSize: 20 }}>⚠️</span>
                        <div>
                            <strong style={{ color: '#ef4444' }}>Error loading data</strong>
                            <p style={{ color: 'var(--text-muted)', marginTop: 4, fontSize: 14 }}>{error}</p>
                            <button className="btn-primary" style={{ marginTop: 12 }} onClick={fetchData}>Retry</button>
                        </div>
                    </div>
                </div>
            )}

            {!loading && !error && data && (
                <>
                    {/* Setup prompt for Meta Ads */}
                    {isAdmin && (isMeta ? !metaData?.isConfigured : isOverview ? !overviewData?.isConfigured.meta : false) && (
                        <div className="section-card" style={{ borderColor: '#f59e0b44', marginBottom: 20 }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                                <span style={{ fontSize: 20 }}>⚠️</span>
                                <div>
                                    <strong style={{ color: '#f59e0b' }}>Connect your Meta Ads account</strong>
                                    <p style={{ color: 'var(--text-muted)', marginTop: 4, fontSize: 13 }}>
                                        Add <code style={{ color: 'var(--accent)' }}>META_ADS_ACCESS_TOKEN</code> to <code>.env.local</code> with <code>ads_read</code> permission.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Setup prompt for Google Ads */}
                    {isAdmin && (isGoogle ? !googleData?.isConfigured : isOverview ? !overviewData?.isConfigured.google : false) && (
                        <div className="section-card" style={{ borderColor: '#f59e0b44', marginBottom: 20 }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                                <span style={{ fontSize: 20 }}>⚠️</span>
                                <div>
                                    <strong style={{ color: '#f59e0b' }}>Connect your Google Ads account</strong>
                                    <p style={{ color: 'var(--text-muted)', marginTop: 4, fontSize: 13 }}>
                                        Add Developer Token and OAuth credentials to <code>.env.local</code>.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* True ROAS Banner (Admin) - Only on Meta Ads for now */}
                    {isAdmin && roasData && isMeta && (
                        <TrueRoasBanner roas={roasData} isMock={roasData.isMock} onOpenDetails={() => setShowRoasModal(true)} />
                    )}

                    {/* Performance Summary (Benchmarks) */}
                    {!isOverview && campaigns.length > 0 && (
                        <PerformanceSummary
                            campaigns={campaigns}
                            platform={isGoogle ? 'google' : 'meta'}
                            isAdmin={isAdmin}
                        />
                    )}

                    {/* KPI Cards */}
                    <div className="metrics-grid" style={{ marginBottom: 24 }}>
                        {isAdmin && (
                            <KpiCard label="Total Spend" value={fmt$(acc?.totalSpend)} sub={`${acc?.currency || 'USD'} • ${periodLabel}`} gold />
                        )}
                        <KpiCard label="Impressions" value={fmtNum(acc?.totalImpressions)} sub={`${fmtNum(acc?.totalReach)} reach`} />
                        <KpiCard label="Clicks" value={fmtNum(acc?.totalClicks)} sub={`CTR ${fmtPct(overallCtr)}`} />
                        <KpiCard
                            label="Leads (Results)"
                            value={fmtNum(acc?.totalResults)}
                            sub={isAdmin && acc?.totalSpend && acc.totalResults ? `${fmt$(acc.totalSpend / acc.totalResults)}/lead` : 'conversions'}
                        />
                        {isAdmin && roasData && roasData.trueRoas !== null && (
                            <KpiCard label="True ROAS" value={`${roasData.trueRoas.toFixed(2)}x`} sub="MindBody verified" green />
                        )}
                        {isAdmin && roasData && roasData.totalAppointmentsBooked > 0 && (
                            <KpiCard
                                label="Appts Booked"
                                value={fmtNum(roasData.totalAppointmentsBooked)}
                                sub={roasData.metaLeads > 0 ? `${Math.round((roasData.totalAppointmentsBooked / roasData.metaLeads) * 100)}% of leads` : 'from matched leads'}
                            />
                        )}
                        {isAdmin && roasData && roasData.totalAppointmentsCompleted > 0 && (
                            <KpiCard
                                label="Appts Completed"
                                value={fmtNum(roasData.totalAppointmentsCompleted)}
                                sub={roasData.totalAppointmentsBooked > 0 ? `${Math.round((roasData.totalAppointmentsCompleted / roasData.totalAppointmentsBooked) * 100)}% show rate` : 'from matched leads'}
                                green
                            />
                        )}
                    </div>

                    {/* Trend Chart */}
                    {chartData.length > 1 && (
                        <div className="section-card" style={{ marginBottom: 24 }}>
                            <h3 style={{ marginBottom: 16 }}>
                                {isAdmin ? 'Spend, Clicks & Leads' : 'Clicks & Leads'} — {periodLabel}
                            </h3>
                            <ResponsiveContainer width="100%" height={240}>
                                <AreaChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                                        </linearGradient>
                                        <linearGradient id="clickGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#60a5fa" stopOpacity={0} />
                                        </linearGradient>
                                        <linearGradient id="leadGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} interval="preserveStartEnd" />
                                    <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                                    <Tooltip content={<CustomTooltip isAdmin={isAdmin} />} />
                                    <Legend wrapperStyle={{ fontSize: 12 }} />
                                    {isAdmin && !isOverview && (
                                        <Area type="monotone" dataKey="Spend" stroke={isGoogle ? '#EA4335' : 'var(--accent)'} fill="url(#spendGrad)" strokeWidth={2} dot={false} />
                                    )}
                                    {isAdmin && isOverview && (
                                        <>
                                            <Area type="monotone" dataKey="Meta Spend" stackId="1" stroke="var(--accent)" fill="url(#spendGrad)" strokeWidth={2} dot={false} />
                                            <Area type="monotone" dataKey="Google Spend" stackId="1" stroke="#EA4335" fill="url(#spendGrad)" strokeWidth={2} dot={false} />
                                        </>
                                    )}
                                    <Area type="monotone" dataKey="Clicks" stroke="#60a5fa" fill="url(#clickGrad)" strokeWidth={2} dot={false} />
                                    <Area type="monotone" dataKey="Leads" stroke="#22c55e" fill="url(#leadGrad)" strokeWidth={2} dot={false} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    )}

                    {/* Leads by Campaign Bar Chart */}
                    {filteredForChart.length > 0 && (
                        <div className="section-card" style={{ marginBottom: 24 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                                <h3>Leads by Campaign</h3>
                                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                    {statusFilter !== 'ALL' ? `${statusFilter.charAt(0) + statusFilter.slice(1).toLowerCase()} only` : 'All campaigns'}
                                </span>
                            </div>
                            <ResponsiveContainer width="100%" height={Math.max(80, filteredForChart.length * 48)}>
                                <BarChart
                                    data={filteredForChart.map(c => ({
                                        name: c.name.length > 30 ? c.name.slice(0, 30) + '…' : c.name,
                                        Leads: c.results,
                                    }))}
                                    layout="vertical"
                                    margin={{ left: 0, right: 40, top: 0, bottom: 0 }}
                                >
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                                    <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                                    <YAxis dataKey="name" type="category" width={200} tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                                    <Tooltip contentStyle={{ background: '#1a2332', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
                                    <Bar dataKey="Leads" fill="var(--accent)" radius={[0, 4, 4, 0]} maxBarSize={24} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    )}

                    {/* Campaigns Table */}
                    <div className="section-card">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                            <h3>Campaigns</h3>
                            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{campaigns.length} total</span>
                        </div>
                        <CampaignsTable
                            campaigns={campaigns}
                            roasDict={roasDict}
                            isAdmin={isAdmin}
                            statusFilter={statusFilter}
                            onStatusFilter={setStatusFilter}
                            isOverview={isOverview}
                            isGoogle={isGoogle}
                            onAnalyze={!isOverview ? analyzeWithAI : undefined}
                            aiAnalysis={aiAnalysis}
                            aiExpanded={aiExpanded}
                            onToggleAI={(id) => setAiExpanded(prev => {
                                const next = new Set(prev);
                                if (next.has(id)) next.delete(id); else next.add(id);
                                return next;
                            })}
                            aiLoading={aiLoading}
                        />
                    </div>
                </>
            )}

            {/* ROAS Details Modal */}
            {showRoasModal && roasData && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100,
                    background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24
                }}>
                    <div style={{
                        background: '#1a2332', border: '1px solid var(--border)', borderRadius: 16,
                        width: '100%', maxWidth: 900, maxHeight: '90vh', display: 'flex', flexDirection: 'column',
                        boxShadow: '0 20px 40px rgba(0,0,0,0.4)'
                    }}>
                        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <h2 style={{ margin: 0 }}>ROAS Reconciliation Details</h2>
                                <p style={{ margin: '4px 0 0 0', color: 'var(--text-muted)', fontSize: 13 }}>
                                    Matching Meta Leads to MindBody purchasing clients by email address.
                                </p>
                            </div>
                            <button onClick={() => setShowRoasModal(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 24 }}>&times;</button>
                        </div>
                        <div style={{ padding: 24, overflowY: 'auto' }}>
                            {roasData.matchedClientsDetails && roasData.matchedClientsDetails.length > 0 ? (
                                <div className="data-table-wrapper"><table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Patient Name</th>
                                            <th>Email</th>
                                            <th>Campaign</th>
                                            <th>Sale Amount</th>
                                            <th>Lead Cost</th>
                                            <th>Patient ROAS</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {roasData.matchedClientsDetails.map((m, i) => (
                                            <tr key={i}>
                                                <td style={{ fontWeight: 500 }}>{m.clientName || 'Unknown'}</td>
                                                <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>{m.email}</td>
                                                <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>{m.campaignName || m.campaignId}</td>
                                                <td style={{ color: '#22c55e', fontWeight: 600 }}>
                                                    {fmt$(m.revenue)}
                                                    {m.isSplit && <span style={{ fontSize: 10, padding: '2px 4px', borderRadius: 4, background: '#f59e0b22', color: '#f59e0b', marginLeft: 6, fontWeight: 500 }} title="Revenue split equally across multiple lead forms from this patient">Split</span>}
                                                </td>
                                                <td style={{ color: 'var(--accent)' }}>{fmt$(m.leadCost)}</td>
                                                <td>{m.leadCost > 0 ? `${(m.revenue / m.leadCost).toFixed(1)}x` : '—'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table></div>
                            ) : (
                                <div className="empty-state">
                                    <h3>No matched clients</h3>
                                    <p>Try selecting a wider date range.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
