'use client';

import { useSession } from 'next-auth/react';
import { useState, useEffect, useCallback, useRef } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend,
} from 'recharts';

type Tab = 'pipeline' | 'strategy' | 'engagement' | 'attribution' | 'legacy';
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
    { id: 'engagement' as Tab, label: 'Engagement Intelligence', adminOnly: true },
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

    // Engagement intelligence data (admin-only, Phase 27)
    const [engagementData, setEngagementData] = useState<any>(null);
    const [engagementLoading, setEngagementLoading] = useState(false);
    const engagementFetchedRef = useRef<string | null>(null);

    // Pipeline reorganization state
    const [reorgData, setReorgData] = useState<any>(null);
    const [reorgLoading, setReorgLoading] = useState(false);
    const [reorgOpen, setReorgOpen] = useState(false);
    const [reorgSelected, setReorgSelected] = useState<Set<string>>(new Set());
    const [reorgApplying, setReorgApplying] = useState(false);
    const [reorgResults, setReorgResults] = useState<any>(null);

    // Transcript viewer state
    const [transcriptOpen, setTranscriptOpen] = useState(false);
    const [transcriptData, setTranscriptData] = useState<any>(null);
    const [transcriptLoading, setTranscriptLoading] = useState(false);
    const [transcriptContactName, setTranscriptContactName] = useState('');

    // SMS Re-activation state
    const [smsOpen, setSmsOpen] = useState(false);
    const [smsStep, setSmsStep] = useState<1 | 2 | 3>(1); // 1: select segment, 2: compose, 3: results
    const [smsSegment, setSmsSegment] = useState<string>('cancelled');
    const [smsData, setSmsData] = useState<any>(null);
    const [smsLoading, setSmsLoading] = useState(false);
    const [smsError, setSmsError] = useState<string | null>(null);
    const [smsMessage, setSmsMessage] = useState('');
    const [smsSelected, setSmsSelected] = useState<Set<string>>(new Set());
    const [smsSending, setSmsSending] = useState(false);
    const [smsResults, setSmsResults] = useState<any>(null);

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

    // Fetch engagement intelligence
    const fetchEngagement = useCallback(async () => {
        setEngagementLoading(true);
        try {
            const params = new URLSearchParams({ mode: 'full' });
            if (location !== 'all') params.set('location', location);
            const res = await fetch(`/api/attribution/ghl-conversations?${params}`);
            if (res.ok) {
                setEngagementData(await res.json());
            }
        } catch {
            // Supplementary — don't block UI
        } finally {
            setEngagementLoading(false);
        }
    }, [location]);

    // Fetch pipeline reorg recommendations
    const fetchReorgRecommendations = useCallback(async () => {
        setReorgLoading(true);
        setReorgResults(null);
        try {
            const params = location !== 'all' ? `?location=${location}` : '';
            const res = await fetch(`/api/attribution/ghl-pipeline-reorg${params}`);
            if (res.ok) {
                const data = await res.json();
                setReorgData(data);
                // Pre-select high-confidence recommendations
                const selected = new Set<string>();
                (data.recommendations || []).forEach((r: any) => {
                    if (r.confidence === 'high') selected.add(r.opportunityId);
                });
                setReorgSelected(selected);
            }
        } catch {
            // Supplementary
        } finally {
            setReorgLoading(false);
        }
    }, [location]);

    // Fetch call transcript
    const fetchTranscript = useCallback(async (messageId: string, locationKey: string, contactName: string) => {
        setTranscriptOpen(true);
        setTranscriptLoading(true);
        setTranscriptContactName(contactName);
        setTranscriptData(null);
        try {
            const res = await fetch(`/api/attribution/ghl-transcript?messageId=${messageId}&location=${locationKey}`);
            if (res.ok) {
                setTranscriptData(await res.json());
            }
        } catch {
            // Error
        } finally {
            setTranscriptLoading(false);
        }
    }, []);

    // Fetch SMS eligible contacts — all segments go through the API route
    const fetchSmsContacts = useCallback(async (segment: string) => {
        setSmsLoading(true);
        setSmsError(null);
        setSmsData(null);
        try {
            const params = new URLSearchParams({ segment });
            if (location !== 'all') params.set('location', location);
            const res = await fetch(`/api/attribution/ghl-reactivation?${params}`);
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || `Failed to load contacts (${res.status})`);
            }
            const data = await res.json();
            setSmsData(data);
            setSmsSelected(new Set((data.contacts || []).map((c: any) => c.contactId)));
            // Auto-select the matching template
            const tmpl = data.templates?.[segment];
            if (tmpl?.template) setSmsMessage(tmpl.template);
        } catch (err: unknown) {
            setSmsError(err instanceof Error ? err.message : 'Failed to load contacts');
        } finally {
            setSmsLoading(false);
        }
    }, [location]);

    // Send SMS campaign
    const sendSmsCampaign = useCallback(async () => {
        if (!smsData?.contacts || smsSelected.size === 0 || !smsMessage) return;
        setSmsSending(true);
        try {
            // Group by location
            const contactsByLocation = new Map<string, any[]>();
            for (const c of smsData.contacts) {
                if (!smsSelected.has(c.contactId)) continue;
                const list = contactsByLocation.get(c.locationKey) || [];
                list.push(c);
                contactsByLocation.set(c.locationKey, list);
            }

            const allResults: any[] = [];
            for (const [locKey, contacts] of contactsByLocation) {
                const res = await fetch('/api/attribution/ghl-reactivation', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contactIds: contacts.map((c: any) => c.contactId),
                        contacts,
                        message: smsMessage,
                        locationKey: locKey,
                    }),
                });
                if (res.ok) {
                    const data = await res.json();
                    allResults.push(data);
                }
            }

            const totalSent = allResults.reduce((s, r) => s + (r.sent || 0), 0);
            const totalFailed = allResults.reduce((s, r) => s + (r.failed || 0), 0);
            const totalSkipped = allResults.reduce((s, r) => s + (r.skipped || 0), 0);
            setSmsResults({ sent: totalSent, failed: totalFailed, skipped: totalSkipped });
            setSmsStep(3);
        } catch {
            // Error
        } finally {
            setSmsSending(false);
        }
    }, [smsData, smsSelected, smsMessage]);

    // Apply selected stage moves
    const applyReorgMoves = useCallback(async () => {
        if (!reorgData?.recommendations || reorgSelected.size === 0) return;
        setReorgApplying(true);
        try {
            const moves = reorgData.recommendations
                .filter((r: any) => reorgSelected.has(r.opportunityId))
                .map((r: any) => ({
                    opportunityId: r.opportunityId,
                    newStageId: r.recommendedStageId,
                    pipelineId: r.pipelineId,
                    locationKey: r.locationKey,
                }));
            const res = await fetch('/api/attribution/ghl-pipeline-reorg', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ moves }),
            });
            if (res.ok) {
                setReorgResults(await res.json());
            }
        } catch {
            // Error handling
        } finally {
            setReorgApplying(false);
        }
    }, [reorgData, reorgSelected]);

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

    useEffect(() => {
        if (session && tab === 'engagement' && isAdmin && engagementFetchedRef.current !== location) {
            engagementFetchedRef.current = location;
            fetchEngagement();
        }
    }, [session, tab, isAdmin, fetchEngagement, location]);

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
                {TAB_CONFIG.filter(t => !t.adminOnly || isAdmin).map(t => (
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

            {/* Tab: Engagement Intelligence (Admin-only) */}
            {tab === 'engagement' && isAdmin && (
                <>
                    {engagementLoading ? (
                        <div className="section-card">
                            <div className="empty-state">
                                <h3>Analyzing conversations...</h3>
                                <p>Fetching engagement data from GHL Conversations API across all locations. This may take 30-60 seconds on first load.</p>
                            </div>
                        </div>
                    ) : engagementData ? (
                        <>
                            {/* KPI Cards */}
                            <div className="metrics-grid" style={{ gridTemplateColumns: `repeat(${(engagementData.summary?.mindbodyActiveFiltered || 0) > 0 ? 6 : 5}, 1fr)` }}>
                                <div className="metric-card">
                                    <div className="label">Total Analyzed</div>
                                    <div className="value">{engagementData.summary?.totalAnalyzed || 0}</div>
                                    <div className="change">{engagementData.summary?.withConversations || 0} with conversations</div>
                                </div>
                                <div className="metric-card">
                                    <div className="label">Needs Outreach</div>
                                    <div className="value" style={{ color: '#FBBF24' }}>{engagementData.summary?.needsOutreach || 0}</div>
                                    <div className="change">7-14 day gap</div>
                                </div>
                                <div className="metric-card">
                                    <div className="label">Going Cold</div>
                                    <div className="value" style={{ color: '#F87171' }}>{engagementData.summary?.goingCold || 0}</div>
                                    <div className="change">14-30 day gap</div>
                                </div>
                                <div className="metric-card">
                                    <div className="label">False Positives</div>
                                    <div className="value" style={{ color: '#34D399' }}>{engagementData.summary?.falsePositives || 0}</div>
                                    <div className="change">Stale by timestamp, active by comms</div>
                                </div>
                                <div className="metric-card">
                                    <div className="label">Lost Revenue</div>
                                    <div className="value" style={{ color: '#F87171' }}>
                                        {formatCurrency(engagementData.summary?.lostRevenuePotential || 0)}
                                    </div>
                                    <div className="change">{engagementData.lostRevenueCandidates?.length || 0} candidates</div>
                                </div>
                                {(engagementData.summary?.mindbodyActiveFiltered || 0) > 0 && (
                                    <div className="metric-card">
                                        <div className="label">MB Active</div>
                                        <div className="value" style={{ color: '#60A5FA' }}>{engagementData.summary.mindbodyActiveFiltered}</div>
                                        <div className="change">Already spending — no outreach needed</div>
                                    </div>
                                )}
                            </div>

                            {/* Lifecycle Breakdown + Speed-to-Lead Row */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                                {/* Lifecycle Stages */}
                                {engagementData.lifecycleCounts && (
                                    <div className="section-card">
                                        <h3 style={{ marginBottom: '16px' }}>Lifecycle Breakdown</h3>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            {([
                                                { key: 'untouched', label: 'Untouched', color: '#94A3B8', desc: 'Never contacted' },
                                                { key: 'attempted', label: 'Attempted', color: '#FBBF24', desc: 'Outbound sent, no reply' },
                                                { key: 'engaged', label: 'Engaged', color: '#60A5FA', desc: 'Two-way conversation' },
                                                { key: 'quoted', label: 'Quoted', color: '#A78BFA', desc: 'Discussed pricing/services' },
                                                { key: 'ghost', label: 'Ghost', color: '#F87171', desc: 'Was engaged, went silent' },
                                                { key: 'converted', label: 'Converted', color: '#34D399', desc: 'Opportunity won' },
                                            ] as const).map(stage => {
                                                const count = engagementData.lifecycleCounts[stage.key] || 0;
                                                const total = engagementData.summary?.totalAnalyzed || 1;
                                                const pct = Math.round((count / total) * 100);
                                                return (
                                                    <div key={stage.key} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                        <span style={{ width: '100px', fontSize: '0.8125rem', color: stage.color, fontWeight: 600, flexShrink: 0 }}>
                                                            {stage.label}
                                                        </span>
                                                        <div style={{ flex: 1, height: '8px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                                                            <div style={{ width: `${pct}%`, height: '100%', background: stage.color, borderRadius: '4px' }} />
                                                        </div>
                                                        <span style={{ width: '80px', textAlign: 'right', fontSize: '0.8125rem', fontWeight: 600 }}>
                                                            {count} ({pct}%)
                                                        </span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                {/* Speed-to-Lead */}
                                {engagementData.speedToLead && (
                                    <div className="section-card">
                                        <h3 style={{ marginBottom: '16px' }}>Speed-to-Lead</h3>
                                        <div style={{ marginBottom: '16px', padding: '12px', background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.2)', borderRadius: '8px', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                                            Industry benchmark: Leads contacted within 5 minutes have a 21x higher conversion rate.
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                            {(['decatur', 'smyrna', 'kennesaw'] as const).map(loc => {
                                                const avg = engagementData.speedToLead.avgMinutes?.[loc];
                                                if (avg === null || avg === undefined) return null;
                                                const label = loc === 'decatur' ? 'Decatur' : loc === 'smyrna' ? 'Smyrna/Vinings' : 'Kennesaw';
                                                const formatted = avg >= 60 ? `${(avg / 60).toFixed(1)} hr` : `${avg} min`;
                                                const color = avg <= 5 ? '#34D399' : avg <= 30 ? '#FBBF24' : '#F87171';
                                                return (
                                                    <div key={loc} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: '6px' }}>
                                                        <span style={{ fontSize: '0.875rem' }}>{label}</span>
                                                        <span style={{ fontWeight: 700, color, fontSize: '1rem' }}>{formatted}</span>
                                                    </div>
                                                );
                                            })}
                                            {engagementData.speedToLead.neverResponded > 0 && (
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: '6px' }}>
                                                    <span style={{ fontSize: '0.875rem', color: '#F87171' }}>Never Responded</span>
                                                    <span style={{ fontWeight: 700, color: '#F87171', fontSize: '1rem' }}>{engagementData.speedToLead.neverResponded}</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Engagement Gaps Table */}
                            {engagementData.engagementGaps?.length > 0 && (
                                <div className="section-card" style={{ marginTop: '24px' }}>
                                    <div className="chart-header" style={{ marginBottom: '16px' }}>
                                        <h3>Engagement Gaps — Needs Outreach</h3>
                                        <span className="badge warning">{engagementData.engagementGaps.length} leads</span>
                                    </div>
                                    <div className="data-table-wrapper"><table className="data-table">
                                        <thead>
                                            <tr>
                                                <th>Name</th>
                                                <th>Location</th>
                                                <th>Stage</th>
                                                <th style={{ textAlign: 'right' }}>Value</th>
                                                <th style={{ textAlign: 'right' }}>Last Outreach</th>
                                                <th style={{ textAlign: 'right' }}>Gap</th>
                                                <th style={{ textAlign: 'center' }}>Score</th>
                                                <th style={{ textAlign: 'center' }}>Calls</th>
                                                <th style={{ textAlign: 'center' }}>MB</th>
                                                <th>Risk</th>
                                                <th>Suggested Action</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {engagementData.engagementGaps.map((gap: any, idx: number) => {
                                                const riskColors: Record<string, string> = {
                                                    'needs-outreach': '#FBBF24',
                                                    'going-cold': '#FB923C',
                                                    'abandoned': '#F87171',
                                                };
                                                const riskLabels: Record<string, string> = {
                                                    'needs-outreach': 'Needs Outreach',
                                                    'going-cold': 'Going Cold',
                                                    'abandoned': 'Abandoned',
                                                };
                                                return (
                                                    <tr key={idx}>
                                                        <td style={{ fontWeight: 600 }}>{gap.opportunity?.contactName || gap.contactName || 'Unknown'}</td>
                                                        <td style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>{gap.locationName}</td>
                                                        <td style={{ fontSize: '0.8125rem' }}>{gap.stageName}</td>
                                                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCurrency(gap.monetaryValue)}</td>
                                                        <td style={{ textAlign: 'right', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                                                            {gap.engagement?.lastOutboundDate
                                                                ? new Date(gap.engagement.lastOutboundDate).toLocaleDateString()
                                                                : 'Never'}
                                                        </td>
                                                        <td style={{ textAlign: 'right', fontWeight: 600, color: gap.daysSinceOutreach > 30 ? '#F87171' : gap.daysSinceOutreach > 14 ? '#FB923C' : '#FBBF24' }}>
                                                            {gap.daysSinceOutreach}d
                                                        </td>
                                                        <td style={{ textAlign: 'center' }}>
                                                            <span style={{
                                                                display: 'inline-block',
                                                                padding: '2px 8px',
                                                                borderRadius: '12px',
                                                                fontSize: '0.75rem',
                                                                fontWeight: 700,
                                                                background: gap.achievabilityScore >= 60 ? 'rgba(52,211,153,0.15)' :
                                                                    gap.achievabilityScore >= 30 ? 'rgba(251,191,36,0.15)' : 'rgba(248,113,113,0.15)',
                                                                color: gap.achievabilityScore >= 60 ? '#34D399' :
                                                                    gap.achievabilityScore >= 30 ? '#FBBF24' : '#F87171',
                                                            }}>
                                                                {gap.achievabilityScore}
                                                            </span>
                                                        </td>
                                                        <td style={{ textAlign: 'center' }}>
                                                            {(gap.engagement?.messageBreakdown?.call?.inbound || 0) + (gap.engagement?.messageBreakdown?.call?.outbound || 0) > 0 ? (
                                                                <span style={{ color: '#A78BFA', fontWeight: 600, fontSize: '0.8125rem' }}>
                                                                    {(gap.engagement?.messageBreakdown?.call?.inbound || 0) + (gap.engagement?.messageBreakdown?.call?.outbound || 0)}
                                                                </span>
                                                            ) : (
                                                                <span style={{ color: 'var(--text-muted)' }}>—</span>
                                                            )}
                                                        </td>
                                                        <td style={{ textAlign: 'center' }}>
                                                            {gap.mindbodyMatch ? (
                                                                <span title={`MB Revenue: $${gap.mindbodyMatch.totalRevenue?.toLocaleString() || 0} | Last visit: ${gap.mindbodyMatch.daysSinceLastVisit ?? '?'}d ago`} style={{
                                                                    display: 'inline-block',
                                                                    padding: '2px 6px',
                                                                    borderRadius: '4px',
                                                                    fontSize: '0.6875rem',
                                                                    fontWeight: 700,
                                                                    background: gap.mindbodyMatch.isActive ? 'rgba(96,165,250,0.15)' : 'rgba(251,191,36,0.15)',
                                                                    color: gap.mindbodyMatch.isActive ? '#60A5FA' : '#FBBF24',
                                                                }}>
                                                                    {gap.mindbodyMatch.isActive ? 'Active' : `${gap.mindbodyMatch.daysSinceLastVisit}d`}
                                                                </span>
                                                            ) : (
                                                                <span style={{ color: 'var(--text-muted)' }}>—</span>
                                                            )}
                                                        </td>
                                                        <td>
                                                            <span style={{
                                                                padding: '3px 8px',
                                                                borderRadius: '4px',
                                                                fontSize: '0.75rem',
                                                                fontWeight: 600,
                                                                background: `${riskColors[gap.riskLevel]}20`,
                                                                color: riskColors[gap.riskLevel],
                                                            }}>
                                                                {riskLabels[gap.riskLevel]}
                                                            </span>
                                                        </td>
                                                        <td style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', maxWidth: '250px' }}>
                                                            {gap.suggestedAction}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table></div>
                                </div>
                            )}

                            {/* Lost Revenue Candidates */}
                            {engagementData.lostRevenueCandidates?.length > 0 && (
                                <div style={{ marginTop: '24px' }}>
                                    <h3 style={{ marginBottom: '16px' }}>Lost Revenue Candidates</h3>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
                                        {engagementData.lostRevenueCandidates.slice(0, 12).map((candidate: any, idx: number) => (
                                            <div key={idx} className="section-card" style={{ borderLeft: '3px solid #F87171' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                                                    <div>
                                                        <div style={{ fontWeight: 600, fontSize: '0.9375rem' }}>
                                                            {candidate.opportunity?.contactName || 'Unknown'}
                                                        </div>
                                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                                            {candidate.locationName} — {candidate.stageName}
                                                        </div>
                                                    </div>
                                                    <div style={{ fontWeight: 700, fontSize: '1.125rem', color: '#F87171' }}>
                                                        {formatCurrency(candidate.monetaryValue)}
                                                    </div>
                                                </div>
                                                <div style={{ display: 'flex', gap: '16px', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                                                    <span>{candidate.conversationCount} conversation{candidate.conversationCount !== 1 ? 's' : ''}</span>
                                                    <span>{candidate.daysSilent}d silent</span>
                                                </div>
                                                <div style={{ marginTop: '8px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                                    Last contact: {candidate.lastContactDate ? new Date(candidate.lastContactDate).toLocaleDateString() : 'Unknown'}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Staff Performance */}
                            {engagementData.staffMetrics?.length > 0 && (
                                <div className="section-card" style={{ marginTop: '24px' }}>
                                    <h3 style={{ marginBottom: '16px' }}>Staff Activity</h3>
                                    <div className="data-table-wrapper"><table className="data-table">
                                        <thead>
                                            <tr>
                                                <th>Staff ID</th>
                                                <th>Location</th>
                                                <th style={{ textAlign: 'right' }}>Conversations</th>
                                                <th style={{ textAlign: 'right' }}>Messages</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {engagementData.staffMetrics.map((staff: any, idx: number) => (
                                                <tr key={idx}>
                                                    <td style={{ fontWeight: 600, fontFamily: 'monospace', fontSize: '0.8125rem' }}>{staff.userId}</td>
                                                    <td style={{ fontSize: '0.8125rem' }}>
                                                        {staff.locationKey === 'decatur' ? 'Decatur' : staff.locationKey === 'smyrna' ? 'Smyrna/Vinings' : 'Kennesaw'}
                                                    </td>
                                                    <td style={{ textAlign: 'right' }}>{staff.conversationsHandled}</td>
                                                    <td style={{ textAlign: 'right' }}>{staff.totalMessages}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table></div>
                                </div>
                            )}

                            {/* Action Buttons Row */}
                            <div style={{ marginTop: '24px', display: 'flex', gap: '12px' }}>
                                <button
                                    onClick={() => { setReorgOpen(true); fetchReorgRecommendations(); }}
                                    style={{
                                        padding: '10px 20px', background: 'rgba(96,165,250,0.15)',
                                        border: '1px solid rgba(96,165,250,0.3)', borderRadius: '8px',
                                        color: '#60A5FA', fontWeight: 600, cursor: 'pointer', fontSize: '0.875rem',
                                    }}
                                >
                                    Reorganize Pipeline
                                </button>
                                <button
                                    onClick={() => { setSmsOpen(true); setSmsStep(1); setSmsResults(null); setSmsError(null); setSmsData(null); }}
                                    style={{
                                        padding: '10px 20px', background: 'rgba(52,211,153,0.15)',
                                        border: '1px solid rgba(52,211,153,0.3)', borderRadius: '8px',
                                        color: '#34D399', fontWeight: 600, cursor: 'pointer', fontSize: '0.875rem',
                                    }}
                                >
                                    Re-activate Leads (SMS)
                                </button>
                            </div>

                            {/* Pipeline Reorganization Modal */}
                            {reorgOpen && (
                                <div style={{
                                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    zIndex: 1000, padding: '20px',
                                }} onClick={() => setReorgOpen(false)}>
                                    <div style={{
                                        background: 'var(--surface-card)', borderRadius: '12px',
                                        width: '100%', maxWidth: '900px', maxHeight: '85vh', overflow: 'auto',
                                        padding: '24px', border: '1px solid var(--border-subtle)',
                                    }} onClick={e => e.stopPropagation()}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                            <h3 style={{ margin: 0 }}>Pipeline Reorganization</h3>
                                            <button onClick={() => setReorgOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.25rem' }}>X</button>
                                        </div>

                                        {/* Warning banner */}
                                        <div style={{
                                            padding: '12px 16px', marginBottom: '16px',
                                            background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)',
                                            borderRadius: '8px', fontSize: '0.8125rem', color: '#FBBF24', lineHeight: 1.5,
                                        }}>
                                            Moving leads between stages may trigger GHL automations (emails, texts, workflows). Review each move before applying.
                                        </div>

                                        {reorgLoading ? (
                                            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                                                Analyzing conversation data for stage recommendations...
                                            </div>
                                        ) : reorgResults ? (
                                            <div>
                                                <div style={{
                                                    padding: '16px', marginBottom: '16px',
                                                    background: reorgResults.summary?.failed === 0 ? 'rgba(52,211,153,0.1)' : 'rgba(251,191,36,0.1)',
                                                    border: `1px solid ${reorgResults.summary?.failed === 0 ? 'rgba(52,211,153,0.3)' : 'rgba(251,191,36,0.3)'}`,
                                                    borderRadius: '8px', fontSize: '0.9375rem', fontWeight: 600,
                                                    color: reorgResults.summary?.failed === 0 ? '#34D399' : '#FBBF24',
                                                }}>
                                                    {reorgResults.message}
                                                </div>
                                                <button onClick={() => { setReorgOpen(false); setReorgResults(null); fetchEngagement(); }} style={{
                                                    padding: '10px 20px', background: 'var(--accent-primary)', border: 'none',
                                                    borderRadius: '8px', color: '#0A225C', fontWeight: 600, cursor: 'pointer',
                                                }}>
                                                    Close & Refresh
                                                </button>
                                            </div>
                                        ) : reorgData?.recommendations?.length > 0 ? (
                                            <>
                                                <div style={{ marginBottom: '12px', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                                                    {reorgData.recommendations.length} recommended moves ({reorgSelected.size} selected)
                                                </div>
                                                <div className="data-table-wrapper"><table className="data-table" style={{ fontSize: '0.8125rem' }}>
                                                    <thead>
                                                        <tr>
                                                            <th style={{ width: '30px' }}>
                                                                <input
                                                                    type="checkbox"
                                                                    checked={reorgSelected.size === reorgData.recommendations.length}
                                                                    onChange={e => {
                                                                        if (e.target.checked) {
                                                                            setReorgSelected(new Set(reorgData.recommendations.map((r: any) => r.opportunityId)));
                                                                        } else {
                                                                            setReorgSelected(new Set());
                                                                        }
                                                                    }}
                                                                />
                                                            </th>
                                                            <th>Name</th>
                                                            <th>Current Stage</th>
                                                            <th style={{ textAlign: 'center' }}>→</th>
                                                            <th>Recommended Stage</th>
                                                            <th>Reason</th>
                                                            <th style={{ textAlign: 'center' }}>Confidence</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {reorgData.recommendations.map((rec: any) => (
                                                            <tr key={rec.opportunityId}>
                                                                <td>
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={reorgSelected.has(rec.opportunityId)}
                                                                        onChange={e => {
                                                                            const next = new Set(reorgSelected);
                                                                            if (e.target.checked) next.add(rec.opportunityId);
                                                                            else next.delete(rec.opportunityId);
                                                                            setReorgSelected(next);
                                                                        }}
                                                                    />
                                                                </td>
                                                                <td style={{ fontWeight: 600 }}>{rec.contactName}</td>
                                                                <td>{rec.currentStageName}</td>
                                                                <td style={{ textAlign: 'center', color: 'var(--text-muted)' }}>→</td>
                                                                <td style={{ fontWeight: 600, color: '#60A5FA' }}>{rec.recommendedStageName}</td>
                                                                <td style={{ color: 'var(--text-secondary)' }}>{rec.reason}</td>
                                                                <td style={{ textAlign: 'center' }}>
                                                                    <span style={{
                                                                        padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600,
                                                                        background: rec.confidence === 'high' ? 'rgba(52,211,153,0.15)' : 'rgba(251,191,36,0.15)',
                                                                        color: rec.confidence === 'high' ? '#34D399' : '#FBBF24',
                                                                    }}>
                                                                        {rec.confidence}
                                                                    </span>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table></div>
                                                <div style={{ marginTop: '16px', display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                                                    <button onClick={() => setReorgOpen(false)} style={{
                                                        padding: '10px 20px', background: 'transparent', border: '1px solid var(--border-subtle)',
                                                        borderRadius: '8px', color: 'var(--text-secondary)', cursor: 'pointer',
                                                    }}>
                                                        Cancel
                                                    </button>
                                                    <button
                                                        onClick={() => { if (confirm(`This will move ${reorgSelected.size} leads and may trigger GHL automations. Proceed?`)) applyReorgMoves(); }}
                                                        disabled={reorgSelected.size === 0 || reorgApplying}
                                                        style={{
                                                            padding: '10px 20px', background: reorgSelected.size > 0 ? 'var(--accent-primary)' : 'rgba(255,255,255,0.1)',
                                                            border: 'none', borderRadius: '8px', color: '#0A225C', fontWeight: 600,
                                                            cursor: reorgSelected.size > 0 ? 'pointer' : 'not-allowed', opacity: reorgApplying ? 0.5 : 1,
                                                        }}
                                                    >
                                                        {reorgApplying ? 'Applying...' : `Apply ${reorgSelected.size} Move${reorgSelected.size !== 1 ? 's' : ''}`}
                                                    </button>
                                                </div>
                                            </>
                                        ) : (
                                            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                                                No stage moves recommended. Your pipeline stages look accurate based on conversation data.
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* SMS Re-activation Modal */}
                            {smsOpen && (
                                <div style={{
                                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    zIndex: 1000, padding: '20px',
                                }} onClick={() => setSmsOpen(false)}>
                                    <div style={{
                                        background: '#0F1729', borderRadius: '12px',
                                        width: '100%', maxWidth: '800px', maxHeight: '85vh', overflow: 'auto',
                                        padding: '24px', border: '1px solid rgba(255,255,255,0.15)',
                                        boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
                                    }} onClick={e => e.stopPropagation()}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                            <h3 style={{ margin: 0 }}>SMS Re-activation Campaign</h3>
                                            <button onClick={() => setSmsOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.25rem' }}>X</button>
                                        </div>

                                        {/* Step 1: Select Campaign */}
                                        {smsStep === 1 && (
                                            <div>
                                                <p style={{ color: 'var(--text-secondary)', marginBottom: '16px', fontSize: '0.875rem' }}>Who do you want to re-engage?</p>

                                                {/* Highest Intent */}
                                                <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px', fontWeight: 600 }}>Highest Intent</div>
                                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '16px' }}>
                                                    {[
                                                        { id: 'cancelled', label: "Let's Reschedule", sub: 'Cancelled / no-showed', color: '#F87171' },
                                                        { id: 'consult-only', label: 'Consulted, Not Treated', sub: 'Had consult, never booked', color: '#FB923C' },
                                                        { id: 'engaged', label: 'Engaged Leads', sub: 'Interested, never booked', color: '#FBBF24' },
                                                    ].map(seg => (
                                                        <button
                                                            key={seg.id}
                                                            onClick={() => setSmsSegment(seg.id)}
                                                            style={{
                                                                padding: '12px 10px', textAlign: 'center',
                                                                background: smsSegment === seg.id ? `${seg.color}15` : 'rgba(255,255,255,0.03)',
                                                                border: `1px solid ${smsSegment === seg.id ? seg.color : 'var(--border-subtle)'}`,
                                                                borderRadius: '8px', cursor: 'pointer',
                                                            }}
                                                        >
                                                            <div style={{ fontWeight: 600, color: seg.color, fontSize: '0.8125rem' }}>{seg.label}</div>
                                                            <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '2px' }}>{seg.sub}</div>
                                                        </button>
                                                    ))}
                                                </div>

                                                {/* Lapsed Patients */}
                                                <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px', fontWeight: 600 }}>Lapsed Patients</div>
                                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '16px' }}>
                                                    {[
                                                        { id: 'lapsed-recent', label: 'Due for Refresh', sub: '2-4 months ago', color: '#60A5FA' },
                                                        { id: 'lapsed-vip', label: 'VIP Welcome Back', sub: '$500+, 4-12 months', color: '#818CF8' },
                                                        { id: 'lapsed-long', label: 'Long-Lapsed', sub: '6+ months ago', color: '#A78BFA' },
                                                    ].map(seg => (
                                                        <button
                                                            key={seg.id}
                                                            onClick={() => setSmsSegment(seg.id)}
                                                            style={{
                                                                padding: '12px 10px', textAlign: 'center',
                                                                background: smsSegment === seg.id ? `${seg.color}15` : 'rgba(255,255,255,0.03)',
                                                                border: `1px solid ${smsSegment === seg.id ? seg.color : 'var(--border-subtle)'}`,
                                                                borderRadius: '8px', cursor: 'pointer',
                                                            }}
                                                        >
                                                            <div style={{ fontWeight: 600, color: seg.color, fontSize: '0.8125rem' }}>{seg.label}</div>
                                                            <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '2px' }}>{seg.sub}</div>
                                                        </button>
                                                    ))}
                                                </div>

                                                {/* Pipeline Leads */}
                                                <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px', fontWeight: 600 }}>Pipeline Leads</div>
                                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '20px' }}>
                                                    {[
                                                        { id: 'ghost', label: 'Ghosted Quotes', sub: 'Discussed pricing, silent', color: '#2DD4BF' },
                                                        { id: 'untouched', label: 'Untouched Leads', sub: 'Never heard back', color: '#E879F9' },
                                                        { id: 'pipeline-followup', label: 'Pipeline Follow-Up', sub: 'Gone quiet 14+ days', color: '#94A3B8' },
                                                    ].map(seg => (
                                                        <button
                                                            key={seg.id}
                                                            onClick={() => setSmsSegment(seg.id)}
                                                            style={{
                                                                padding: '12px 10px', textAlign: 'center',
                                                                background: smsSegment === seg.id ? `${seg.color}15` : 'rgba(255,255,255,0.03)',
                                                                border: `1px solid ${smsSegment === seg.id ? seg.color : 'var(--border-subtle)'}`,
                                                                borderRadius: '8px', cursor: 'pointer',
                                                            }}
                                                        >
                                                            <div style={{ fontWeight: 600, color: seg.color, fontSize: '0.8125rem' }}>{seg.label}</div>
                                                            <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '2px' }}>{seg.sub}</div>
                                                        </button>
                                                    ))}
                                                </div>

                                                <button
                                                    onClick={() => { setSmsStep(2); fetchSmsContacts(smsSegment); }}
                                                    style={{
                                                        padding: '10px 24px', background: 'var(--accent-primary)', border: 'none',
                                                        borderRadius: '8px', color: '#0A225C', fontWeight: 600, cursor: 'pointer',
                                                    }}
                                                >
                                                    Next: Preview Contacts
                                                </button>
                                            </div>
                                        )}

                                        {/* Step 2: Preview + Compose */}
                                        {smsStep === 2 && (
                                            <div>
                                                {smsLoading ? (
                                                    <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                                                        <div style={{ marginBottom: '8px' }}>Loading eligible contacts...</div>
                                                        <div style={{ fontSize: '0.75rem' }}>This may take a few seconds for MindBody segments</div>
                                                    </div>
                                                ) : smsError ? (
                                                    <div style={{ textAlign: 'center', padding: '40px' }}>
                                                        <div style={{ color: '#F87171', marginBottom: '12px', fontSize: '0.9375rem' }}>Failed to load contacts</div>
                                                        <div style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', marginBottom: '16px' }}>{smsError}</div>
                                                        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                                                            <button onClick={() => setSmsStep(1)} style={{
                                                                padding: '8px 16px', background: 'transparent', border: '1px solid var(--border-subtle)',
                                                                borderRadius: '6px', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.8125rem',
                                                            }}>Back</button>
                                                            <button onClick={() => fetchSmsContacts(smsSegment)} style={{
                                                                padding: '8px 16px', background: 'rgba(255,255,255,0.08)', border: '1px solid var(--border-subtle)',
                                                                borderRadius: '6px', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.8125rem',
                                                            }}>Retry</button>
                                                        </div>
                                                    </div>
                                                ) : smsData && smsData.contacts?.length > 0 ? (
                                                    <>
                                                        {/* Forecast Summary */}
                                                        {smsData.forecast && (
                                                            <div style={{
                                                                padding: '12px 16px', marginBottom: '16px',
                                                                background: 'rgba(255,255,255,0.03)', borderRadius: '8px',
                                                                fontSize: '0.875rem', color: 'var(--text-secondary)',
                                                            }}>
                                                                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{smsData.forecast.targetContacts}</span> contacts
                                                                {' | '}~<span style={{ fontWeight: 600 }}>${smsData.forecast.estimatedCost}</span> est. cost
                                                                {' | '}~<span style={{ fontWeight: 600, color: '#34D399' }}>{smsData.forecast.predictedBookings}</span> predicted bookings
                                                                {smsData.forecast.projectedROI > 0 && (
                                                                    <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginLeft: '8px' }}>
                                                                        ({smsData.forecast.projectedROI}x projected ROI)
                                                                    </span>
                                                                )}
                                                            </div>
                                                        )}

                                                        {/* Template + Message */}
                                                        <div style={{ marginBottom: '16px' }}>
                                                            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '10px' }}>
                                                                <label style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Template:</label>
                                                                <select
                                                                    onChange={e => { if (e.target.value) setSmsMessage(e.target.value); }}
                                                                    value={smsMessage}
                                                                    style={{
                                                                        flex: 1, padding: '8px 12px', background: 'rgba(255,255,255,0.05)',
                                                                        border: '1px solid var(--border-subtle)', borderRadius: '6px',
                                                                        color: 'var(--text-primary)', fontSize: '0.8125rem',
                                                                    }}
                                                                >
                                                                    <option value="">Custom message...</option>
                                                                    {Object.entries(smsData.templates || {}).map(([key, tmpl]: [string, any]) => (
                                                                        <option key={key} value={tmpl.template}>{tmpl.label}</option>
                                                                    ))}
                                                                </select>
                                                            </div>
                                                            <textarea
                                                                value={smsMessage}
                                                                onChange={e => setSmsMessage(e.target.value)}
                                                                rows={3}
                                                                style={{
                                                                    width: '100%', padding: '10px', background: 'rgba(255,255,255,0.05)',
                                                                    border: '1px solid var(--border-subtle)', borderRadius: '8px',
                                                                    color: 'var(--text-primary)', fontSize: '0.875rem', resize: 'vertical',
                                                                }}
                                                                placeholder="Type your message... Use {{firstName}} for personalization"
                                                            />
                                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                                                                {smsMessage.length} chars | Variables: {'{{firstName}}'}, {'{{locationName}}'}, {'{{serviceName}}'}
                                                            </div>
                                                        </div>

                                                        {/* Message Preview */}
                                                        {smsData.contacts?.length > 0 && smsMessage && (
                                                            <div style={{ marginBottom: '16px' }}>
                                                                <label style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>Preview:</label>
                                                                {smsData.contacts.slice(0, 2).map((c: any, idx: number) => (
                                                                    <div key={idx} style={{
                                                                        padding: '8px 12px', marginBottom: '4px',
                                                                        background: 'rgba(255,255,255,0.03)', borderRadius: '6px',
                                                                        fontSize: '0.8125rem', color: 'var(--text-secondary)',
                                                                    }}>
                                                                        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{c.contactName}</span>:{' '}
                                                                        {smsMessage
                                                                            .replace(/\{\{firstName\}\}/g, c.firstName || 'there')
                                                                            .replace(/\{\{locationName\}\}/g, c.locationName || 'Chin Up!')
                                                                            .replace(/\{\{serviceName\}\}/g, c.serviceName || 'your appointment')}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}

                                                        {/* Contact count + actions */}
                                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                                                            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                                                                {smsSelected.size} of {smsData.contacts?.length || 0} contacts selected
                                                                {smsData.dndFiltered > 0 && <span style={{ color: 'var(--text-muted)' }}> ({smsData.dndFiltered} DND excluded)</span>}
                                                            </div>
                                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                                <button
                                                                    onClick={() => setSmsSelected(new Set((smsData.contacts || []).map((c: any) => c.contactId)))}
                                                                    style={{ fontSize: '0.75rem', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                                                                >All</button>
                                                                <button
                                                                    onClick={() => setSmsSelected(new Set())}
                                                                    style={{ fontSize: '0.75rem', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                                                                >None</button>
                                                            </div>
                                                        </div>

                                                        {/* Contact list with checkboxes */}
                                                        <div style={{
                                                            maxHeight: '200px', overflowY: 'auto', marginBottom: '16px',
                                                            border: '1px solid var(--border-subtle)', borderRadius: '8px',
                                                        }}>
                                                            {(smsData.contacts || []).map((c: any) => {
                                                                const isSelected = smsSelected.has(c.contactId);
                                                                return (
                                                                    <div
                                                                        key={c.contactId}
                                                                        onClick={() => {
                                                                            const next = new Set(smsSelected);
                                                                            if (isSelected) next.delete(c.contactId);
                                                                            else next.add(c.contactId);
                                                                            setSmsSelected(next);
                                                                        }}
                                                                        style={{
                                                                            display: 'flex', alignItems: 'center', gap: '10px',
                                                                            padding: '8px 12px', cursor: 'pointer',
                                                                            background: isSelected ? 'rgba(52,211,153,0.08)' : 'transparent',
                                                                            borderBottom: '1px solid rgba(255,255,255,0.04)',
                                                                            fontSize: '0.8125rem',
                                                                        }}
                                                                    >
                                                                        <span style={{
                                                                            width: '16px', height: '16px', borderRadius: '3px', flexShrink: 0,
                                                                            border: isSelected ? '2px solid #34D399' : '2px solid var(--border-subtle)',
                                                                            background: isSelected ? '#34D399' : 'transparent',
                                                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                            color: '#0A225C', fontSize: '0.625rem', fontWeight: 700,
                                                                        }}>
                                                                            {isSelected && '✓'}
                                                                        </span>
                                                                        <span style={{ fontWeight: 500, color: 'var(--text-primary)', minWidth: '140px' }}>{c.contactName}</span>
                                                                        <span style={{ color: 'var(--text-muted)' }}>{c.maskedPhone}</span>
                                                                        <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>{c.locationName}</span>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>

                                                        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                                                            <button onClick={() => setSmsStep(1)} style={{
                                                                padding: '10px 20px', background: 'transparent', border: '1px solid var(--border-subtle)',
                                                                borderRadius: '8px', color: 'var(--text-secondary)', cursor: 'pointer',
                                                            }}>
                                                                Back
                                                            </button>
                                                            <button
                                                                onClick={() => {
                                                                    if (confirm(`This will send ${smsSelected.size} SMS messages. Estimated cost: $${smsData.forecast?.estimatedCost || '?'}. Proceed?`))
                                                                        sendSmsCampaign();
                                                                }}
                                                                disabled={smsSelected.size === 0 || !smsMessage || smsSending}
                                                                style={{
                                                                    padding: '10px 24px', background: smsSelected.size > 0 && smsMessage ? '#34D399' : 'rgba(255,255,255,0.1)',
                                                                    border: 'none', borderRadius: '8px', color: '#0A225C', fontWeight: 600,
                                                                    cursor: smsSelected.size > 0 ? 'pointer' : 'not-allowed', opacity: smsSending ? 0.5 : 1,
                                                                }}
                                                            >
                                                                {smsSending ? 'Sending...' : `Send to ${smsSelected.size} Contact${smsSelected.size !== 1 ? 's' : ''}`}
                                                            </button>
                                                        </div>
                                                    </>
                                                ) : (
                                                    <div style={{ textAlign: 'center', padding: '40px' }}>
                                                        <div style={{ color: 'var(--text-muted)', fontSize: '0.9375rem', marginBottom: '8px' }}>No eligible contacts found</div>
                                                        <div style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', marginBottom: '4px' }}>
                                                            {smsData?.dndFiltered > 0 && <span>{smsData.dndFiltered} contacts excluded (DND/opted-out). </span>}
                                                            {smsData?.totalEligible === 0 && 'All contacts in this segment are either active patients, on DND, or have no phone number.'}
                                                        </div>
                                                        {/* Debug funnel — shows where contacts were lost */}
                                                        {smsData?.debug && (
                                                            <div style={{
                                                                marginTop: '16px', padding: '12px', textAlign: 'left',
                                                                background: 'rgba(255,255,255,0.03)', borderRadius: '8px',
                                                                fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.6,
                                                            }}>
                                                                <div style={{ fontWeight: 600, marginBottom: '4px', color: 'var(--text-secondary)' }}>Diagnostic Funnel:</div>
                                                                {Object.entries(smsData.debug).map(([key, val]) => (
                                                                    <div key={key}>
                                                                        <span style={{ color: 'var(--text-secondary)' }}>{key}:</span>{' '}
                                                                        {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                        <button onClick={() => setSmsStep(1)} style={{
                                                            marginTop: '12px', padding: '8px 16px', background: 'transparent',
                                                            border: '1px solid var(--border-subtle)', borderRadius: '6px',
                                                            color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.8125rem',
                                                        }}>Try Another Campaign</button>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* Step 3: Results */}
                                        {smsStep === 3 && smsResults && (
                                            <div>
                                                <div style={{
                                                    padding: '20px', textAlign: 'center', marginBottom: '20px',
                                                    background: smsResults.failed === 0 ? 'rgba(52,211,153,0.1)' : 'rgba(251,191,36,0.1)',
                                                    border: `1px solid ${smsResults.failed === 0 ? 'rgba(52,211,153,0.3)' : 'rgba(251,191,36,0.3)'}`,
                                                    borderRadius: '8px',
                                                }}>
                                                    <div style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '8px', color: smsResults.failed === 0 ? '#34D399' : '#FBBF24' }}>
                                                        Campaign Sent
                                                    </div>
                                                    <div style={{ display: 'flex', justifyContent: 'center', gap: '24px', fontSize: '0.9375rem', color: 'var(--text-secondary)' }}>
                                                        <span style={{ color: '#34D399' }}>{smsResults.sent} sent</span>
                                                        {smsResults.failed > 0 && <span style={{ color: '#F87171' }}>{smsResults.failed} failed</span>}
                                                        {smsResults.skipped > 0 && <span style={{ color: 'var(--text-muted)' }}>{smsResults.skipped} skipped</span>}
                                                    </div>
                                                </div>
                                                <button onClick={() => { setSmsOpen(false); setSmsResults(null); }} style={{
                                                    padding: '10px 24px', background: 'var(--accent-primary)', border: 'none',
                                                    borderRadius: '8px', color: '#0A225C', fontWeight: 600, cursor: 'pointer',
                                                }}>
                                                    Close
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Transcript Modal */}
                            {transcriptOpen && (
                                <div style={{
                                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    zIndex: 1000, padding: '20px',
                                }} onClick={() => setTranscriptOpen(false)}>
                                    <div style={{
                                        background: 'var(--surface-card)', borderRadius: '12px',
                                        width: '100%', maxWidth: '700px', maxHeight: '80vh', overflow: 'auto',
                                        padding: '24px', border: '1px solid var(--border-subtle)',
                                    }} onClick={e => e.stopPropagation()}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                            <h3 style={{ margin: 0 }}>Call Transcript — {transcriptContactName}</h3>
                                            <button onClick={() => setTranscriptOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.25rem' }}>X</button>
                                        </div>

                                        {/* PHI Warning */}
                                        <div style={{
                                            padding: '10px 14px', marginBottom: '16px',
                                            background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)',
                                            borderRadius: '8px', fontSize: '0.8125rem', color: '#F87171',
                                        }}>
                                            This transcript may contain protected health information (PHI). Do not share or copy outside this dashboard.
                                        </div>

                                        {transcriptLoading ? (
                                            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>Loading transcript...</div>
                                        ) : transcriptData?.transcript?.length > 0 ? (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                {transcriptData.transcript.map((seg: any, idx: number) => (
                                                    <div key={idx} style={{
                                                        display: 'flex', gap: '12px',
                                                        flexDirection: seg.mediaChannel === 1 ? 'row' : 'row-reverse',
                                                    }}>
                                                        <div style={{
                                                            padding: '10px 14px',
                                                            background: seg.mediaChannel === 1 ? 'rgba(96,165,250,0.1)' : 'rgba(52,211,153,0.1)',
                                                            border: `1px solid ${seg.mediaChannel === 1 ? 'rgba(96,165,250,0.2)' : 'rgba(52,211,153,0.2)'}`,
                                                            borderRadius: seg.mediaChannel === 1 ? '12px 12px 12px 4px' : '12px 12px 4px 12px',
                                                            maxWidth: '75%', fontSize: '0.875rem', lineHeight: 1.5,
                                                        }}>
                                                            <div style={{ fontSize: '0.7rem', fontWeight: 600, marginBottom: '4px', color: seg.mediaChannel === 1 ? '#60A5FA' : '#34D399' }}>
                                                                {seg.mediaChannel === 1 ? 'Patient' : 'Staff'}
                                                            </div>
                                                            {seg.transcript}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                                                No transcript available for this call.
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* DND filtered count */}
                            {(engagementData.summary?.dndFiltered || 0) > 0 && (
                                <div style={{ marginTop: '16px', padding: '10px 16px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                                    {engagementData.summary.dndFiltered} contacts excluded from analysis (DND/opted-out)
                                </div>
                            )}

                            {/* Data freshness */}
                            {engagementData.fetchedAt && (
                                <div style={{ marginTop: '8px', fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'right' }}>
                                    Data fetched: {new Date(engagementData.fetchedAt).toLocaleString()}
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="section-card">
                            <div className="empty-state">
                                <h3>No engagement data</h3>
                                <p>Conversation intelligence requires GHL v2 Private Integration Tokens. Check your PIT configuration.</p>
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
