'use client';

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
import { fmt$, fmtNum, fmtPct } from '@/lib/format';
import { gradeAllMetrics } from '@/lib/ads-benchmarks';
import {
    type Campaign, type CampaignBreakdown, type RoasData, type StatusFilter,
    objectiveLabel, StatusBadge, GradeDot, PerformanceSummary, KpiCard,
    TrueRoasBanner, CampaignsTable, CustomTooltip,
} from '@/components/ads/AdsHelpers';

// --- Types ---

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

// --- Constants ---

const TABS = ['Overview', 'Meta Ads', 'Google Ads'] as const;
type Tab = typeof TABS[number];

// (Helper components extracted to @/components/ads/AdsHelpers.tsx)

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
                            sub={isAdmin && acc?.totalSpend != null && acc.totalResults ? `${fmt$(acc.totalSpend / acc.totalResults)}/lead` : 'conversions'}
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
