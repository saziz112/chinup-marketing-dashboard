'use client';

import { useSession } from 'next-auth/react';
import { useState, useEffect, useCallback } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend,
} from 'recharts';

type Tab = 'pipeline' | 'strategy' | 'attribution' | 'legacy';
type LocationFilter = 'all' | 'decatur' | 'smyrna' | 'kennesaw';

interface StageData {
    id: string;
    name: string;
    position: number;
    count: number;
    value: number;
}

interface PipelineData {
    id: string;
    name: string;
    stages: StageData[];
    totalOpen: number;
    totalValue: number;
    wonCount: number;
    lostCount: number;
}

interface LocationSummary {
    location: string;
    locationName: string;
    pipelines: PipelineData[];
}

interface PipelineResponse {
    configured: boolean;
    locations: LocationSummary[];
    totals: {
        totalOpen: number;
        totalValue: number;
        totalWon: number;
        totalWonValue: number;
        totalLost: number;
        conversionRate: number;
    };
    sourceBreakdown: { source: string; count: number; value: number }[];
    fetchedAt: string;
}

// Legacy types
interface SourceData {
    platform: string;
    label: string;
    count: number;
    percentage: number;
    newClients: number;
    returningClients: number;
}

interface RevenueSourceData {
    platform: string;
    label: string;
    clientCount: number;
    revenue: number;
    revenuePerClient: number;
}

const CHART_COLORS = [
    '#D8B41D', '#60A5FA', '#34D399', '#F87171', '#A78BFA',
    '#FBBF24', '#FB923C', '#2DD4BF', '#E879F9', '#94A3B8', '#818CF8',
];

const TOOLTIP_STYLE = {
    background: '#0A225C',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: '#FEFEFE',
};

const TAB_CONFIG = [
    { id: 'pipeline' as Tab, label: 'Pipeline Overview' },
    { id: 'strategy' as Tab, label: 'Strategy & Reactivation' },
    { id: 'attribution' as Tab, label: 'Attribution' },
    { id: 'legacy' as Tab, label: 'MindBody Legacy' },
];

const LOCATION_OPTIONS = [
    { id: 'all' as LocationFilter, label: 'All Locations' },
    { id: 'decatur' as LocationFilter, label: 'Decatur' },
    { id: 'smyrna' as LocationFilter, label: 'Smyrna/Vinings' },
    { id: 'kennesaw' as LocationFilter, label: 'Kennesaw' },
];

function formatCurrency(val: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);
}

function formatNumber(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toLocaleString();
}

export default function LeadsPipelinePage() {
    const { data: session } = useSession();
    const user = session?.user as Record<string, unknown> | undefined;
    const isAdmin = user?.isAdmin === true;

    const [tab, setTab] = useState<Tab>('pipeline');
    const [location, setLocation] = useState<LocationFilter>('all');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Pipeline data
    const [pipelineData, setPipelineData] = useState<PipelineResponse | null>(null);

    // Strategy data
    const [strategyData, setStrategyData] = useState<any>(null);
    const [strategyLoading, setStrategyLoading] = useState(false);

    // Legacy data
    const [legacyPeriod, setLegacyPeriod] = useState<'7d' | '30d' | '90d'>('30d');
    const [legacyData, setLegacyData] = useState<{
        totalClients: number;
        totalNew: number;
        topSource: string;
        bySource: SourceData[];
        revenueData: { totalRevenue: string; avgRevenuePerClient: string; bySource: RevenueSourceData[] } | null;
    } | null>(null);
    const [legacyLoading, setLegacyLoading] = useState(false);

    // Revenue attribution data (GHL → MindBody email match)
    const [revenueAttribution, setRevenueAttribution] = useState<any>(null);
    const [revenueLoading, setRevenueLoading] = useState(false);
    const [attrPeriod, setAttrPeriod] = useState<'7d' | '30d' | '90d'>('30d');

    // Fetch pipeline data
    const fetchPipeline = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const params = location !== 'all' ? `?location=${location}` : '';
            const res = await fetch(`/api/attribution/ghl-pipeline${params}`);
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to fetch pipeline data');
            }
            const data: PipelineResponse = await res.json();
            setPipelineData(data);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    }, [location]);

    // Fetch strategy data
    const fetchStrategy = useCallback(async () => {
        setStrategyLoading(true);
        try {
            const params = location !== 'all' ? `?location=${location}` : '';
            const res = await fetch(`/api/attribution/ghl-strategy${params}`);
            if (res.ok) {
                setStrategyData(await res.json());
            }
        } catch {
            // Strategy is supplementary — don't block UI
        } finally {
            setStrategyLoading(false);
        }
    }, [location]);

    // Fetch legacy data
    const fetchLegacy = useCallback(async () => {
        setLegacyLoading(true);
        try {
            const leadsRes = await fetch(`/api/attribution/leads?period=${legacyPeriod}`);
            if (!leadsRes.ok) return;
            const leadsData = await leadsRes.json();

            let revenueData = null;
            if (isAdmin) {
                const revRes = await fetch(`/api/attribution/revenue?period=${legacyPeriod}`);
                if (revRes.ok) {
                    const revData = await revRes.json();
                    revenueData = {
                        totalRevenue: revData.formattedRevenue || '$0.00',
                        avgRevenuePerClient: revData.formattedAvgRevenue || '$0.00',
                        bySource: revData.bySource || [],
                    };
                }
            }

            setLegacyData({
                totalClients: leadsData.totalClients || 0,
                totalNew: leadsData.totalNew || 0,
                topSource: leadsData.topSource || 'N/A',
                bySource: leadsData.bySource || [],
                revenueData,
            });
        } catch {
            // Silent fail for legacy
        } finally {
            setLegacyLoading(false);
        }
    }, [legacyPeriod, isAdmin]);

    // Fetch revenue attribution (GHL emails → MindBody revenue)
    const fetchRevenueAttribution = useCallback(async () => {
        setRevenueLoading(true);
        try {
            const params = new URLSearchParams({ period: attrPeriod });
            if (location !== 'all') params.set('location', location);
            const res = await fetch(`/api/attribution/ghl-revenue?${params}`);
            if (res.ok) {
                setRevenueAttribution(await res.json());
            }
        } catch {
            // Revenue is supplementary — don't block UI
        } finally {
            setRevenueLoading(false);
        }
    }, [attrPeriod, location]);

    useEffect(() => {
        if (session) {
            fetchPipeline();
        }
    }, [session, fetchPipeline]);

    useEffect(() => {
        if (session && tab === 'strategy') {
            fetchStrategy();
        }
    }, [session, tab, fetchStrategy]);

    useEffect(() => {
        if (session && tab === 'legacy') {
            fetchLegacy();
        }
    }, [session, tab, fetchLegacy]);

    useEffect(() => {
        if (session && tab === 'attribution') {
            fetchRevenueAttribution();
        }
    }, [session, tab, fetchRevenueAttribution]);

    // Computed values
    const allPipelines = pipelineData?.locations.flatMap(l => l.pipelines) || [];
    const totalStages = allPipelines.flatMap(p => p.stages).reduce((map, s) => {
        const existing = map.get(s.name) || { name: s.name, count: 0, value: 0 };
        existing.count += s.count;
        existing.value += s.value;
        map.set(s.name, existing);
        return map;
    }, new Map<string, { name: string; count: number; value: number }>());

    // Funnel data for bar chart
    const funnelData = Array.from(totalStages.values()).filter(s => s.count > 0);

    // Source breakdown for pie chart
    const sourceData = (pipelineData?.sourceBreakdown || []).slice(0, 10);
    const totalSourceCount = sourceData.reduce((s, d) => s + d.count, 0);

    return (
        <>
            <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
                <div>
                    <h1>Leads & Pipeline</h1>
                    <p className="subtitle">Pipeline analytics, strategy, and attribution across all locations</p>
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

            {/* Tabs */}
            <div style={{ display: 'flex', gap: '4px', marginBottom: '24px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0' }}>
                {TAB_CONFIG.map(t => (
                    <button
                        key={t.id}
                        onClick={() => setTab(t.id)}
                        style={{
                            padding: '10px 20px',
                            background: 'transparent',
                            border: 'none',
                            borderBottom: tab === t.id ? '2px solid var(--accent-primary)' : '2px solid transparent',
                            color: tab === t.id ? 'var(--text-primary)' : 'var(--text-muted)',
                            fontWeight: tab === t.id ? 600 : 400,
                            fontSize: '0.875rem',
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                        }}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {error && (
                <div className="section-card" style={{ borderColor: '#F87171', background: 'rgba(248,113,113,0.1)' }}>
                    <p style={{ color: '#F87171', margin: 0 }}>Error: {error}</p>
                </div>
            )}

            {/* Tab: Pipeline Overview */}
            {tab === 'pipeline' && (
                <>
                    {loading ? (
                        <div className="section-card">
                            <div className="empty-state">
                                <h3>Loading pipeline data...</h3>
                                <p>Fetching opportunities from GoHighLevel across all locations</p>
                            </div>
                        </div>
                    ) : pipelineData ? (
                        <>
                            {/* KPI Cards */}
                            <div className="metrics-grid" style={{ gridTemplateColumns: `repeat(${isAdmin ? 5 : 4}, 1fr)` }}>
                                <div className="metric-card">
                                    <div className="label">Open Opportunities</div>
                                    <div className="value">{formatNumber(pipelineData.totals.totalOpen)}</div>
                                    <div className="change">Active leads in pipeline</div>
                                </div>
                                {isAdmin && (
                                    <div className="metric-card">
                                        <div className="label">Pipeline Value</div>
                                        <div className="value">{formatCurrency(pipelineData.totals.totalValue)}</div>
                                        <div className="change">Total open opportunity value</div>
                                    </div>
                                )}
                                <div className="metric-card">
                                    <div className="label">Won</div>
                                    <div className="value" style={{ color: '#34D399' }}>{formatNumber(pipelineData.totals.totalWon)}</div>
                                    <div className="change positive">Converted clients</div>
                                </div>
                                <div className="metric-card">
                                    <div className="label">Lost</div>
                                    <div className="value" style={{ color: '#F87171' }}>{formatNumber(pipelineData.totals.totalLost)}</div>
                                    <div className="change">Abandoned/lost</div>
                                </div>
                                <div className="metric-card">
                                    <div className="label">Conversion Rate</div>
                                    <div className="value">{pipelineData.totals.conversionRate}%</div>
                                    <div className="change">Won / (Won + Lost)</div>
                                </div>
                            </div>

                            {/* Charts Row */}
                            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px' }}>
                                {/* Funnel Bar Chart */}
                                {funnelData.length > 0 && (
                                    <div className="chart-container">
                                        <div className="chart-header">
                                            <h3>Pipeline Funnel — Open Leads by Stage</h3>
                                        </div>
                                        <ResponsiveContainer width="100%" height={Math.max(200, funnelData.length * 40)}>
                                            <BarChart data={funnelData} layout="vertical" margin={{ left: 10, right: 30, top: 4, bottom: 4 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                                                <XAxis type="number" tick={{ fill: '#A1A1AA', fontSize: 11 }} />
                                                <YAxis dataKey="name" type="category" width={180} tick={{ fill: '#E4E4E7', fontSize: 12 }} />
                                                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(val) => [formatNumber(val as number), 'Leads']} />
                                                <Bar dataKey="count" fill="#60A5FA" radius={[0, 4, 4, 0]} maxBarSize={24} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                )}

                                {/* Source Pie Chart */}
                                {sourceData.length > 0 && (
                                    <div className="chart-container">
                                        <div className="chart-header">
                                            <h3>Lead Sources</h3>
                                            <span className="badge info">{formatNumber(totalSourceCount)} leads</span>
                                        </div>
                                        <ResponsiveContainer width="100%" height={280}>
                                            <PieChart>
                                                <Pie
                                                    data={sourceData.map(s => ({ name: s.source, value: s.count }))}
                                                    cx="50%"
                                                    cy="50%"
                                                    innerRadius={50}
                                                    outerRadius={90}
                                                    dataKey="value"
                                                    label={({ name, percent }) => `${name} (${((percent || 0) * 100).toFixed(0)}%)`}
                                                    labelLine={false}
                                                >
                                                    {sourceData.map((_, i) => (
                                                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                                                    ))}
                                                </Pie>
                                                <Tooltip contentStyle={TOOLTIP_STYLE} />
                                            </PieChart>
                                        </ResponsiveContainer>
                                    </div>
                                )}
                            </div>

                            {/* Per-Location Pipeline Details */}
                            {pipelineData.locations.map(loc => (
                                <div key={loc.location} className="section-card" style={{ marginTop: '24px' }}>
                                    <div className="chart-header" style={{ marginBottom: '16px' }}>
                                        <h3>{loc.locationName}</h3>
                                        <span className="badge info">{loc.pipelines.length} pipeline{loc.pipelines.length !== 1 ? 's' : ''}</span>
                                    </div>

                                    {loc.pipelines.map(pipeline => (
                                        <div key={pipeline.id} style={{ marginBottom: '20px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                                <h4 style={{ margin: 0, fontSize: '0.9375rem' }}>{pipeline.name}</h4>
                                                <div style={{ display: 'flex', gap: '12px', fontSize: '0.8125rem' }}>
                                                    <span style={{ color: 'var(--text-secondary)' }}>{pipeline.totalOpen} open</span>
                                                    <span style={{ color: '#34D399' }}>{pipeline.wonCount} won</span>
                                                    <span style={{ color: '#F87171' }}>{pipeline.lostCount} lost</span>
                                                    {isAdmin && <span style={{ color: 'var(--accent-primary)' }}>{formatCurrency(pipeline.totalValue)}</span>}
                                                </div>
                                            </div>

                                            {/* Stage progress bars */}
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                {pipeline.stages.filter(s => s.count > 0).map(stage => (
                                                    <div key={stage.id} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                        <span style={{ width: '180px', fontSize: '0.8125rem', color: 'var(--text-secondary)', flexShrink: 0 }}>
                                                            {stage.name}
                                                        </span>
                                                        <div style={{ flex: 1, height: '8px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                                                            <div style={{
                                                                width: `${Math.min(100, (stage.count / Math.max(1, pipeline.totalOpen)) * 100)}%`,
                                                                height: '100%',
                                                                background: 'var(--accent-primary)',
                                                                borderRadius: '4px',
                                                                transition: 'width 0.3s',
                                                            }} />
                                                        </div>
                                                        <span style={{ width: '60px', textAlign: 'right', fontSize: '0.8125rem', fontWeight: 600 }}>
                                                            {stage.count}
                                                        </span>
                                                        {isAdmin && stage.value > 0 && (
                                                            <span style={{ width: '80px', textAlign: 'right', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                                                {formatCurrency(stage.value)}
                                                            </span>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </>
                    ) : null}
                </>
            )}

            {/* Tab: Strategy & Reactivation */}
            {tab === 'strategy' && (
                <>
                    {strategyLoading ? (
                        <div className="section-card">
                            <div className="empty-state">
                                <h3>Analyzing pipeline data...</h3>
                                <p>Computing strategic insights and reactivation opportunities</p>
                            </div>
                        </div>
                    ) : strategyData ? (
                        <>
                            {/* Recovery Potential */}
                            {isAdmin && strategyData.recoveryPotential && (
                                <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                                    <div className="metric-card">
                                        <div className="label">Stale Leads</div>
                                        <div className="value">{strategyData.recoveryPotential.totalStaleLeads}</div>
                                        <div className="change">Inactive 14+ days</div>
                                    </div>
                                    <div className="metric-card">
                                        <div className="label">Recovery Potential</div>
                                        <div className="value" style={{ color: '#34D399' }}>
                                            {formatCurrency(strategyData.recoveryPotential.estimatedRevenue)}
                                        </div>
                                        <div className="change">At 15% reactivation rate</div>
                                    </div>
                                    <div className="metric-card">
                                        <div className="label">Priority Leads</div>
                                        <div className="value">{strategyData.recoveryPotential.highPriority}</div>
                                        <div className="change">High-value, 14-30d stale</div>
                                    </div>
                                </div>
                            )}

                            {/* Strategic Insights */}
                            {strategyData.insights?.length > 0 && (
                                <div className="section-card">
                                    <h3 style={{ marginBottom: '16px' }}>Strategic Insights</h3>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                        {strategyData.insights.map((insight: string, idx: number) => (
                                            <div key={idx} style={{
                                                padding: '16px',
                                                background: 'rgba(255,255,255,0.03)',
                                                border: '1px solid var(--border-subtle)',
                                                borderRadius: '8px',
                                                display: 'flex',
                                                alignItems: 'flex-start',
                                                gap: '12px',
                                            }}>
                                                <div style={{
                                                    width: '8px', height: '8px', borderRadius: '50%',
                                                    background: 'var(--accent-primary)', flexShrink: 0, marginTop: '6px',
                                                }} />
                                                <span style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>{insight}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Reactivation Plans by Staleness */}
                            {strategyData.staleBySeverity && (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px' }}>
                                    {[
                                        { key: 'atRisk', label: 'At Risk (14-30d)', color: '#FBBF24', desc: 'Recent — a quick follow-up can save these' },
                                        { key: 'stale', label: 'Stale (30-60d)', color: '#FB923C', desc: 'Cooling off — need re-engagement campaign' },
                                        { key: 'dormant', label: 'Dormant (60d+)', color: '#F87171', desc: 'Cold — requires incentive-based outreach' },
                                    ].map(tier => {
                                        const data = strategyData.staleBySeverity[tier.key];
                                        if (!data || data.count === 0) return null;
                                        return (
                                            <div key={tier.key} className="section-card" style={{ borderLeft: `3px solid ${tier.color}` }}>
                                                <h4 style={{ color: tier.color, marginBottom: '4px' }}>{tier.label}</h4>
                                                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '12px' }}>{tier.desc}</p>
                                                <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{data.count} leads</div>
                                                {isAdmin && data.value > 0 && (
                                                    <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                                                        {formatCurrency(data.value)} pipeline value
                                                    </div>
                                                )}
                                                {data.topStages?.length > 0 && (
                                                    <div style={{ marginTop: '12px', fontSize: '0.8125rem' }}>
                                                        <div style={{ fontWeight: 600, marginBottom: '4px' }}>Top stages:</div>
                                                        {data.topStages.map((s: any, i: number) => (
                                                            <div key={i} style={{ color: 'var(--text-secondary)', padding: '2px 0' }}>
                                                                {s.name}: {s.count}
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                                {data.suggestion && (
                                                    <div style={{
                                                        marginTop: '12px', padding: '10px',
                                                        background: 'rgba(255,255,255,0.03)',
                                                        borderRadius: '6px', fontSize: '0.8125rem',
                                                        color: 'var(--text-secondary)', lineHeight: 1.5,
                                                    }}>
                                                        {data.suggestion}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {/* Location Comparison */}
                            {strategyData.locationComparison?.length > 1 && (
                                <div className="section-card" style={{ marginTop: '24px' }}>
                                    <h3 style={{ marginBottom: '16px' }}>Location Comparison</h3>
                                    <div className="data-table-wrapper"><table className="data-table">
                                        <thead>
                                            <tr>
                                                <th>Location</th>
                                                <th style={{ textAlign: 'right' }}>Open</th>
                                                <th style={{ textAlign: 'right' }}>Won</th>
                                                <th style={{ textAlign: 'right' }}>Lost</th>
                                                <th style={{ textAlign: 'right' }}>Conversion</th>
                                                <th style={{ textAlign: 'right' }}>Stale Leads</th>
                                                {isAdmin && <th style={{ textAlign: 'right' }}>Pipeline Value</th>}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {strategyData.locationComparison.map((loc: any) => (
                                                <tr key={loc.location}>
                                                    <td style={{ fontWeight: 600 }}>{loc.locationName}</td>
                                                    <td style={{ textAlign: 'right' }}>{loc.totalOpen}</td>
                                                    <td style={{ textAlign: 'right', color: '#34D399' }}>{loc.wonCount}</td>
                                                    <td style={{ textAlign: 'right', color: '#F87171' }}>{loc.lostCount}</td>
                                                    <td style={{ textAlign: 'right' }}>{loc.conversionRate}%</td>
                                                    <td style={{ textAlign: 'right' }}>{loc.staleCount}</td>
                                                    {isAdmin && <td style={{ textAlign: 'right' }}>{formatCurrency(loc.totalValue)}</td>}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table></div>
                                </div>
                            )}

                            {/* Funnel Analysis — Per Location, Per Pipeline */}
                            {strategyData.funnelAnalysis?.length > 0 && (
                                <div style={{ marginTop: '24px' }}>
                                    <h3 style={{ marginBottom: '16px' }}>Funnel Analysis & Recommendations</h3>

                                    {strategyData.funnelAnalysis.map((funnel: any) => (
                                        <div key={`${funnel.locationKey}-${funnel.pipelineId}`} className="section-card" style={{ marginBottom: '20px' }}>
                                            {/* Pipeline header */}
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                                <div>
                                                    <h4 style={{ margin: 0, fontSize: '1rem' }}>{funnel.locationName} — {funnel.pipelineName}</h4>
                                                    <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>{funnel.totalLeads} active leads</span>
                                                </div>
                                                {funnel.biggestLeak && (
                                                    <div style={{
                                                        padding: '6px 12px',
                                                        background: 'rgba(248,113,113,0.1)',
                                                        border: '1px solid rgba(248,113,113,0.3)',
                                                        borderRadius: '6px',
                                                        fontSize: '0.8125rem',
                                                        color: '#F87171',
                                                    }}>
                                                        Biggest leak: {funnel.biggestLeak.from} → {funnel.biggestLeak.to} ({funnel.biggestLeak.lost} leads, {funnel.biggestLeak.percent}% drop)
                                                    </div>
                                                )}
                                            </div>

                                            {/* Overall recommendation */}
                                            <div style={{
                                                padding: '12px 16px',
                                                background: 'rgba(96,165,250,0.08)',
                                                border: '1px solid rgba(96,165,250,0.2)',
                                                borderRadius: '8px',
                                                marginBottom: '16px',
                                                fontSize: '0.875rem',
                                                color: 'var(--text-secondary)',
                                                lineHeight: 1.6,
                                            }}>
                                                {funnel.overallRecommendation}
                                            </div>

                                            {/* Stage-by-stage breakdown */}
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                {funnel.stages.filter((s: any) => s.count > 0).map((stage: any, idx: number) => (
                                                    <div key={idx} style={{
                                                        padding: '10px 14px',
                                                        background: 'rgba(255,255,255,0.02)',
                                                        border: '1px solid var(--border-subtle)',
                                                        borderRadius: '6px',
                                                    }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                                <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>{stage.name}</span>
                                                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                                                    {stage.count} leads ({stage.percentOfTotal}%)
                                                                </span>
                                                            </div>
                                                            <div style={{ display: 'flex', gap: '12px', fontSize: '0.75rem' }}>
                                                                {isAdmin && stage.value > 0 && (
                                                                    <span style={{ color: 'var(--accent-primary)' }}>{formatCurrency(stage.value)}</span>
                                                                )}
                                                                {stage.dropOffPercent > 0 && (
                                                                    <span style={{ color: stage.dropOffPercent > 50 ? '#F87171' : '#FBBF24' }}>
                                                                        -{stage.dropOffPercent}% from prev
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                        {/* Progress bar */}
                                                        <div style={{ height: '4px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px', margin: '6px 0', overflow: 'hidden' }}>
                                                            <div style={{
                                                                width: `${stage.percentOfTotal}%`,
                                                                height: '100%',
                                                                background: stage.percentOfTotal > 30 ? '#FBBF24' : 'var(--accent-primary)',
                                                                borderRadius: '2px',
                                                            }} />
                                                        </div>
                                                        {/* Recommendation */}
                                                        <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                                                            {stage.recommendation}
                                                        </p>
                                                    </div>
                                                ))}
                                            </div>

                                            {/* New Funnel Suggestions */}
                                            {funnel.newFunnelSuggestions?.length > 0 && (
                                                <div style={{ marginTop: '16px' }}>
                                                    <h5 style={{ margin: '0 0 10px', fontSize: '0.875rem', color: '#34D399' }}>
                                                        New Funnel Suggestions
                                                    </h5>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                        {funnel.newFunnelSuggestions.map((suggestion: string, idx: number) => (
                                                            <div key={idx} style={{
                                                                padding: '10px 14px',
                                                                background: 'rgba(52,211,153,0.05)',
                                                                border: '1px solid rgba(52,211,153,0.15)',
                                                                borderRadius: '6px',
                                                                fontSize: '0.8125rem',
                                                                color: 'var(--text-secondary)',
                                                                lineHeight: 1.5,
                                                            }}>
                                                                {suggestion}
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="section-card">
                            <div className="empty-state">
                                <h3>No strategy data</h3>
                                <p>Strategy analysis requires pipeline data. Check your GHL connection.</p>
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* Tab: Attribution */}
            {tab === 'attribution' && (
                <>
                    {loading ? (
                        <div className="section-card">
                            <div className="empty-state">
                                <h3>Loading attribution data...</h3>
                                <p>Matching GHL lead sources with pipeline data</p>
                            </div>
                        </div>
                    ) : pipelineData && sourceData.length > 0 ? (
                        <>
                            {/* Period selector for MindBody revenue window */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', margin: 0 }}>
                                    GHL lead sources matched against MindBody purchasing clients via email
                                </p>
                                <div className="period-selector">
                                    {(['7d', '30d', '90d'] as const).map(p => (
                                        <button
                                            key={p}
                                            className={`period-btn ${attrPeriod === p ? 'active' : ''}`}
                                            onClick={() => setAttrPeriod(p)}
                                        >
                                            {p === '7d' ? '7 Days' : p === '30d' ? '30 Days' : '90 Days'}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Revenue Attribution KPI Cards */}
                            {revenueAttribution && !revenueLoading && (
                                <div className="metrics-grid" style={{ gridTemplateColumns: `repeat(${isAdmin ? 4 : 3}, 1fr)`, marginBottom: '24px' }}>
                                    {isAdmin && (
                                        <div className="metric-card">
                                            <div className="label">Matched Revenue</div>
                                            <div className="value" style={{ color: '#34D399' }}>{formatCurrency(revenueAttribution.matchedRevenue)}</div>
                                            <div className="change">MindBody verified ({attrPeriod})</div>
                                        </div>
                                    )}
                                    <div className="metric-card">
                                        <div className="label">Match Rate</div>
                                        <div className="value">{revenueAttribution.matchRate ?? 0}%</div>
                                        <div className="change">{revenueAttribution.matchedLeads} of {revenueAttribution.totalLeadsWithContact ?? revenueAttribution.totalLeadsWithEmail ?? revenueAttribution.totalLeads} matched</div>
                                    </div>
                                    {isAdmin && (
                                        <div className="metric-card">
                                            <div className="label">Revenue / Matched Lead</div>
                                            <div className="value">{formatCurrency(revenueAttribution.revenuePerLead ?? 0)}</div>
                                            <div className="change">Avg MindBody spend</div>
                                        </div>
                                    )}
                                    <div className="metric-card">
                                        <div className="label">No Contact Info</div>
                                        <div className="value">{revenueAttribution.totalLeads - (revenueAttribution.totalLeadsWithContact ?? revenueAttribution.totalLeadsWithEmail ?? revenueAttribution.totalLeads)}</div>
                                        <div className="change">Cannot be matched</div>
                                    </div>
                                </div>
                            )}

                            {revenueLoading && (
                                <div className="section-card" style={{ marginBottom: '24px' }}>
                                    <div className="empty-state" style={{ padding: '16px' }}>
                                        <p style={{ margin: 0, color: 'var(--text-muted)' }}>Loading MindBody revenue match...</p>
                                    </div>
                                </div>
                            )}

                            {/* Source breakdown chart */}
                            <div className="chart-container">
                                <div className="chart-header">
                                    <h3>Lead Sources — All Open Opportunities</h3>
                                    <span className="badge info">{formatNumber(totalSourceCount)} leads</span>
                                </div>
                                <ResponsiveContainer width="100%" height={Math.max(200, sourceData.length * 40)}>
                                    <BarChart data={sourceData} layout="vertical" margin={{ left: 10, right: 30, top: 4, bottom: 4 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                                        <XAxis type="number" tick={{ fill: '#A1A1AA', fontSize: 11 }} />
                                        <YAxis dataKey="source" type="category" width={180} tick={{ fill: '#E4E4E7', fontSize: 12 }} />
                                        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(val) => [formatNumber(val as number), 'Leads']} />
                                        <Bar dataKey="count" fill="#60A5FA" radius={[0, 4, 4, 0]} maxBarSize={24}>
                                            {sourceData.map((_, i) => (
                                                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>

                            {/* Source table with revenue columns */}
                            <div className="section-card" style={{ marginTop: '24px' }}>
                                <div className="chart-header" style={{ marginBottom: '16px' }}>
                                    <h3>Source Breakdown</h3>
                                    {revenueAttribution && (
                                        <span className="badge success">{revenueAttribution.matchedLeads} matched</span>
                                    )}
                                </div>
                                <div className="data-table-wrapper"><table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Source</th>
                                            <th style={{ textAlign: 'right' }}>Leads</th>
                                            <th style={{ textAlign: 'right' }}>% of Total</th>
                                            {isAdmin && <th style={{ textAlign: 'right' }}>Pipeline Value</th>}
                                            {revenueAttribution && (
                                                <>
                                                    <th style={{ textAlign: 'right' }}>Matched</th>
                                                    {isAdmin && <th style={{ textAlign: 'right' }}>MB Revenue</th>}
                                                    {isAdmin && <th style={{ textAlign: 'right' }}>Rev/Lead</th>}
                                                    <th style={{ textAlign: 'right' }}>Match Rate</th>
                                                </>
                                            )}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {sourceData.map((src, idx) => {
                                            const revSource = revenueAttribution?.sourceBreakdown?.find(
                                                (r: any) => r.source === src.source
                                            );
                                            return (
                                                <tr key={src.source}>
                                                    <td>
                                                        <span style={{
                                                            display: 'inline-block', width: 10, height: 10,
                                                            borderRadius: '50%', background: CHART_COLORS[idx % CHART_COLORS.length],
                                                            marginRight: 8, verticalAlign: 'middle',
                                                        }} />
                                                        {src.source || 'Unknown'}
                                                    </td>
                                                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{revSource?.totalLeads ?? src.count}</td>
                                                    <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                                                        {totalSourceCount > 0 ? Math.round(((revSource?.totalLeads ?? src.count) / (revenueAttribution?.totalLeads ?? totalSourceCount)) * 100) : 0}%
                                                    </td>
                                                    {isAdmin && (
                                                        <td style={{ textAlign: 'right' }}>{formatCurrency(src.value)}</td>
                                                    )}
                                                    {revenueAttribution && (
                                                        <>
                                                            <td style={{ textAlign: 'right' }}>
                                                                {revSource?.matchedLeads ?? 0}
                                                            </td>
                                                            {isAdmin && (
                                                                <td style={{ textAlign: 'right', fontWeight: 600, color: revSource?.matchedRevenue > 0 ? '#34D399' : 'var(--text-muted)' }}>
                                                                    {formatCurrency(revSource?.matchedRevenue ?? 0)}
                                                                </td>
                                                            )}
                                                            {isAdmin && (
                                                                <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
                                                                    {revSource?.revenuePerLead ? formatCurrency(revSource.revenuePerLead) : '--'}
                                                                </td>
                                                            )}
                                                            <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                                                                {revSource?.matchRate != null ? `${revSource.matchRate}%` : '--'}
                                                            </td>
                                                        </>
                                                    )}
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table></div>
                            </div>

                            {/* Attribution method note */}
                            {revenueAttribution?.attributionNote && (
                                <div style={{
                                    marginTop: '12px', padding: '10px 16px',
                                    background: 'rgba(255,255,255,0.03)',
                                    borderRadius: '8px', fontSize: '0.8125rem',
                                    color: 'var(--text-muted)', lineHeight: 1.5,
                                }}>
                                    {revenueAttribution.attributionNote}
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="section-card">
                            <div className="empty-state">
                                <h3>No attribution data</h3>
                                <p>Connect GoHighLevel to see lead source attribution.</p>
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* Tab: MindBody Legacy */}
            {tab === 'legacy' && (
                <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', margin: 0 }}>
                            MindBody-based attribution (kept for comparison during GHL transition)
                        </p>
                        <div className="period-selector">
                            {(['7d', '30d', '90d'] as const).map(p => (
                                <button
                                    key={p}
                                    className={`period-btn ${legacyPeriod === p ? 'active' : ''}`}
                                    onClick={() => setLegacyPeriod(p)}
                                >
                                    {p === '7d' ? '7 Days' : p === '30d' ? '30 Days' : '90 Days'}
                                </button>
                            ))}
                        </div>
                    </div>

                    {legacyLoading ? (
                        <div className="section-card">
                            <div className="empty-state">
                                <h3>Loading MindBody data...</h3>
                            </div>
                        </div>
                    ) : legacyData ? (
                        <>
                            <div className="metrics-grid" style={{ gridTemplateColumns: `repeat(${isAdmin && legacyData.revenueData ? 4 : 3}, 1fr)` }}>
                                <div className="metric-card">
                                    <div className="label">Purchasing Clients</div>
                                    <div className="value">{legacyData.totalClients}</div>
                                    <div className="change">{legacyData.totalNew} new, {legacyData.totalClients - legacyData.totalNew} returning</div>
                                </div>
                                <div className="metric-card">
                                    <div className="label">New Clients</div>
                                    <div className="value">{legacyData.totalNew}</div>
                                    <div className="change positive">First-time buyers</div>
                                </div>
                                <div className="metric-card">
                                    <div className="label">Top Source</div>
                                    <div className="value" style={{ fontSize: '1.25rem' }}>{legacyData.topSource}</div>
                                    <div className="change">Highest volume</div>
                                </div>
                                {isAdmin && legacyData.revenueData && (
                                    <div className="metric-card">
                                        <div className="label">Total Revenue</div>
                                        <div className="value">{legacyData.revenueData.totalRevenue}</div>
                                        <div className="change">{legacyData.revenueData.avgRevenuePerClient}/client</div>
                                    </div>
                                )}
                            </div>

                            {legacyData.bySource.length > 0 && (
                                <div className="section-card">
                                    <h3>Client Breakdown by Source</h3>
                                    <div className="data-table-wrapper"><table className="data-table">
                                        <thead>
                                            <tr>
                                                <th>Source</th>
                                                <th style={{ textAlign: 'right' }}>Clients</th>
                                                <th style={{ textAlign: 'right' }}>New</th>
                                                <th style={{ textAlign: 'right' }}>%</th>
                                                {isAdmin && legacyData.revenueData && (
                                                    <>
                                                        <th style={{ textAlign: 'right' }}>Revenue</th>
                                                        <th style={{ textAlign: 'right' }}>Rev/Client</th>
                                                    </>
                                                )}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {legacyData.bySource.map((source, idx) => {
                                                const revSource = legacyData.revenueData?.bySource.find(r => r.platform === source.platform);
                                                return (
                                                    <tr key={source.platform}>
                                                        <td>
                                                            <span style={{
                                                                display: 'inline-block', width: 10, height: 10,
                                                                borderRadius: '50%', background: CHART_COLORS[idx % CHART_COLORS.length],
                                                                marginRight: 8, verticalAlign: 'middle',
                                                            }} />
                                                            {source.label}
                                                        </td>
                                                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{source.count}</td>
                                                        <td style={{ textAlign: 'right' }}>
                                                            {source.newClients > 0 ? <span className="badge success">{source.newClients}</span> : '0'}
                                                        </td>
                                                        <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{source.percentage}%</td>
                                                        {isAdmin && legacyData.revenueData && (
                                                            <>
                                                                <td style={{ textAlign: 'right', fontWeight: 600 }}>
                                                                    {revSource ? formatCurrency(revSource.revenue) : '$0'}
                                                                </td>
                                                                <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                                                                    {revSource ? formatCurrency(revSource.revenuePerClient) : '$0'}
                                                                </td>
                                                            </>
                                                        )}
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table></div>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="section-card">
                            <div className="empty-state">
                                <h3>No data for this period</h3>
                                <p>Try a longer time range.</p>
                            </div>
                        </div>
                    )}
                </>
            )}
        </>
    );
}
