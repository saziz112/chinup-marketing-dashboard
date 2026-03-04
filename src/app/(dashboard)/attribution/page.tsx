'use client';

import { useSession } from 'next-auth/react';
import { useState, useEffect, useCallback } from 'react';
import {
    BarChart, Bar,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

type Period = '7d' | '30d' | '90d';

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

export default function AttributionPage() {
    const { data: session } = useSession();
    const user = session?.user as Record<string, unknown> | undefined;
    const isAdmin = user?.isAdmin === true;

    const [period, setPeriod] = useState<Period>('30d');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [totalClients, setTotalClients] = useState(0);
    const [totalNew, setTotalNew] = useState(0);
    const [topSource, setTopSource] = useState('--');
    const [bySource, setBySource] = useState<SourceData[]>([]);

    const [revenueData, setRevenueData] = useState<{
        totalRevenue: string;
        avgRevenuePerClient: string;
        bySource: RevenueSourceData[];
    } | null>(null);

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            const leadsRes = await fetch(`/api/attribution/leads?period=${period}`);
            if (!leadsRes.ok) throw new Error('Failed to fetch attribution data');
            const leadsData = await leadsRes.json();

            setTotalClients(leadsData.totalClients || 0);
            setTotalNew(leadsData.totalNew || 0);
            setTopSource(leadsData.topSource || 'N/A');
            setBySource(leadsData.bySource || []);

            if (isAdmin) {
                const revRes = await fetch(`/api/attribution/revenue?period=${period}`);
                if (revRes.ok) {
                    const revData = await revRes.json();
                    setRevenueData({
                        totalRevenue: revData.formattedRevenue || '$0.00',
                        avgRevenuePerClient: revData.formattedAvgRevenue || '$0.00',
                        bySource: revData.bySource || [],
                    });
                }
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            setError(message);
        } finally {
            setLoading(false);
        }
    }, [period, isAdmin]);

    useEffect(() => {
        if (session) fetchData();
    }, [session, fetchData]);

    // Clients by source — horizontal bar chart data
    const sourceChartData = [...bySource]
        .sort((a, b) => b.count - a.count)
        .map(s => ({ name: s.label, Clients: s.count, New: s.newClients }));

    const formatCurrency = (val: number) =>
        new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);

    return (
        <>
            <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
                <div>
                    <h1>Attribution</h1>
                    <p className="subtitle">Track where your clients come from and measure revenue by source</p>
                </div>
                <div className="period-selector">
                    {(['7d', '30d', '90d'] as Period[]).map(p => (
                        <button
                            key={p}
                            className={`period-btn ${period === p ? 'active' : ''}`}
                            onClick={() => setPeriod(p)}
                        >
                            {p === '7d' ? '7 Days' : p === '30d' ? '30 Days' : '90 Days'}
                        </button>
                    ))}
                </div>
            </div>

            {error && (
                <div className="section-card" style={{ borderColor: 'var(--danger)', background: 'var(--danger-bg)' }}>
                    <p style={{ color: 'var(--danger)', margin: 0 }}>Error: {error}</p>
                </div>
            )}

            {/* KPI Cards */}
            <div className="metrics-grid" style={{ gridTemplateColumns: `repeat(${isAdmin ? 4 : 3}, 1fr)` }}>
                <div className="metric-card">
                    <div className="label">Purchasing Clients</div>
                    <div className="value">{loading ? '...' : totalClients}</div>
                    <div className="change">
                        {!loading && totalClients > 0 && `${totalNew} new, ${totalClients - totalNew} returning`}
                        {!loading && totalClients === 0 && 'From MindBody'}
                    </div>
                </div>
                <div className="metric-card">
                    <div className="label">New Clients</div>
                    <div className="value">{loading ? '...' : totalNew}</div>
                    <div className="change positive">First-time buyers</div>
                </div>
                <div className="metric-card">
                    <div className="label">Top Source</div>
                    <div className="value" style={{ fontSize: totalClients > 0 ? '1.25rem' : undefined }}>{loading ? '...' : topSource}</div>
                    <div className="change">Highest client volume</div>
                </div>
                {isAdmin && revenueData && (
                    <div className="metric-card">
                        <div className="label">Total Revenue</div>
                        <div className="value">{loading ? '...' : revenueData.totalRevenue}</div>
                        <div className="change">{revenueData.avgRevenuePerClient}/client avg</div>
                    </div>
                )}
            </div>

            {/* Charts Row */}
            {!loading && totalClients > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: isAdmin && revenueData ? '1fr 1fr' : '1fr', gap: '24px' }}>
                    {/* Clients by Source — Horizontal Bar Chart */}
                    <div className="chart-container">
                        <div className="chart-header">
                            <h3>Clients by Source</h3>
                            <span className="badge info">{totalClients} total</span>
                        </div>
                        <ResponsiveContainer width="100%" height={Math.max(160, sourceChartData.length * 44)}>
                            <BarChart
                                data={sourceChartData}
                                layout="vertical"
                                margin={{ left: 0, right: 30, top: 4, bottom: 4 }}
                            >
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                                <XAxis type="number" tick={{ fill: '#A1A1AA', fontSize: 11 }} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} />
                                <YAxis
                                    dataKey="name" type="category" width={150}
                                    tick={{ fill: '#E4E4E7', fontSize: 12 }}
                                    axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                                />
                                <Tooltip
                                    contentStyle={{ background: '#0A225C', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#FEFEFE' }}
                                    formatter={(val, name) => [`${val}`, name === 'Clients' ? 'Total' : 'New']}
                                />
                                <Bar dataKey="Clients" fill="#60A5FA" radius={[0, 4, 4, 0]} maxBarSize={20} />
                                <Bar dataKey="New" fill="#D8B41D" radius={[0, 4, 4, 0]} maxBarSize={20} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>

                    {/* Revenue by Source Bar Chart (Admin only) */}
                    {isAdmin && revenueData && revenueData.bySource.length > 0 && (
                        <div className="chart-container">
                            <div className="chart-header">
                                <h3>Revenue by Source</h3>
                                <span className="badge success">{revenueData.totalRevenue}</span>
                            </div>
                            <ResponsiveContainer width="100%" height={320}>
                                <BarChart
                                    data={revenueData.bySource.filter(s => s.revenue > 0)}
                                    margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
                                >
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                    <XAxis
                                        dataKey="label"
                                        tick={{ fill: '#A1A1AA', fontSize: 11 }}
                                        axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                                        angle={-25}
                                        textAnchor="end"
                                        height={60}
                                    />
                                    <YAxis
                                        tick={{ fill: '#A1A1AA', fontSize: 11 }}
                                        axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                                        tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                                    />
                                    <Tooltip
                                        contentStyle={{
                                            background: '#0A225C',
                                            border: '1px solid rgba(255,255,255,0.1)',
                                            borderRadius: '8px',
                                            color: '#FEFEFE',
                                        }}
                                        formatter={(value) => [formatCurrency(value as number), 'Revenue']}
                                    />
                                    <Bar dataKey="revenue" fill="#D8B41D" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    )}
                </div>
            )}

            {/* Source Breakdown Table */}
            {!loading && totalClients > 0 && (
                <div className="section-card">
                    <h3>Client Breakdown by Source</h3>
                    <div className="data-table-wrapper"><table className="data-table">
                        <thead>
                            <tr>
                                <th>Source</th>
                                <th style={{ textAlign: 'right' }}>Clients</th>
                                <th style={{ textAlign: 'right' }}>New</th>
                                <th style={{ textAlign: 'right' }}>%</th>
                                {isAdmin && revenueData && (
                                    <>
                                        <th style={{ textAlign: 'right' }}>Revenue</th>
                                        <th style={{ textAlign: 'right' }}>Rev/Client</th>
                                    </>
                                )}
                            </tr>
                        </thead>
                        <tbody>
                            {bySource.map((source, idx) => {
                                const revSource = revenueData?.bySource.find(r => r.platform === source.platform);
                                return (
                                    <tr key={source.platform}>
                                        <td>
                                            <span style={{
                                                display: 'inline-block',
                                                width: 10,
                                                height: 10,
                                                borderRadius: '50%',
                                                background: CHART_COLORS[idx % CHART_COLORS.length],
                                                marginRight: 8,
                                                verticalAlign: 'middle',
                                            }} />
                                            {source.label}
                                        </td>
                                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{source.count}</td>
                                        <td style={{ textAlign: 'right' }}>
                                            {source.newClients > 0
                                                ? <span className="badge success">{source.newClients}</span>
                                                : <span style={{ color: 'var(--text-muted)' }}>0</span>}
                                        </td>
                                        <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{source.percentage}%</td>
                                        {isAdmin && revenueData && (
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

            {/* Loading / Empty States */}
            {loading && (
                <div className="section-card">
                    <div className="empty-state">
                        <h3>Loading attribution data...</h3>
                        <p>Fetching client and sales data from MindBody</p>
                    </div>
                </div>
            )}

            {!loading && totalClients === 0 && !error && (
                <div className="section-card">
                    <div className="empty-state">
                        <h3>No sales in this period</h3>
                        <p>Try selecting a longer time range to see attribution data.</p>
                    </div>
                </div>
            )}
        </>
    );
}
