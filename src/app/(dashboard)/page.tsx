'use client';

import { useSession } from 'next-auth/react';
import { useState, useEffect } from 'react';
import { Skeleton, SkeletonChart } from '@/components/Skeleton';

import {
    LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

type Period = '7d' | '30d' | '90d';

interface PlatformData {
    followers: string;
    engagement: string;
    configured: boolean;
}

const TOOLTIP_STYLE = {
    background: '#0A225C',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: '#FEFEFE',
};

function formatDate(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatNumber(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toLocaleString();
}

export default function OverviewPage() {
    const { data: session } = useSession();
    const [period, setPeriod] = useState<Period>('30d');
    const [metrics, setMetrics] = useState({
        leads: { val: '--', loading: true },
    });
    const [platforms, setPlatforms] = useState<Record<string, PlatformData>>({
        Instagram: { followers: '--', engagement: '--%', configured: false },
        Facebook: { followers: '--', engagement: '--%', configured: false },
        YouTube: { followers: '--', engagement: '--%', configured: false },
    });

    const [igDataRaw, setIgDataRaw] = useState<any>(null);
    const [fbDataRaw, setFbDataRaw] = useState<any>(null);
    const [socialLoading, setSocialLoading] = useState(true);
    const [googleRating, setGoogleRating] = useState<{ rating: string; reviews: string; fiveStarRate: string; needsAttention: number; loading: boolean }>({ rating: '--', reviews: '--', fiveStarRate: '--', needsAttention: 0, loading: true });
    const [searchData, setSearchData] = useState<{ clicks: number; impressions: number; position: number; loading: boolean }>({ clicks: 0, impressions: 0, position: 0, loading: true });

    const user = session?.user as Record<string, unknown> | undefined;
    const isAdmin = user?.isAdmin === true;
    const displayName = (user?.name as string) || 'there';
    const firstName = displayName.split(' ')[0];

    useEffect(() => {
        const fetchMetrics = async () => {
            setMetrics({ leads: { val: '--', loading: true } });

            try {
                const res = await fetch('/api/metrics/leads');
                const leadsData = await res.json();
                setMetrics({
                    leads: { val: leadsData.count?.toString() || '0', loading: false },
                });
            } catch (error) {
                console.error('[Overview] Failed to fetch leads:', error);
                setMetrics({
                    leads: { val: 'Error', loading: false },
                });
            }
        };

        const fetchGoogleRating = async () => {
            try {
                const res = await fetch('/api/reputation/reviews?location=all');
                const data = await res.json();
                if (data.metrics) {
                    const reviews = data.reviews || [];
                    const fiveStarCount = reviews.filter((r: any) => r.rating === 5).length;
                    const fiveStarRate = reviews.length > 0 ? Math.round((fiveStarCount / reviews.length) * 100) : 0;
                    const needsAttention = reviews.filter((r: any) => r.rating <= 3).length;
                    setGoogleRating({
                        rating: data.metrics.averageRating?.toFixed(1) || '--',
                        reviews: formatNumber(data.metrics.totalReviews || 0),
                        fiveStarRate: `${fiveStarRate}%`,
                        needsAttention,
                        loading: false,
                    });
                } else {
                    setGoogleRating(prev => ({ ...prev, loading: false }));
                }
            } catch (error) {
                console.error('[Overview] Failed to fetch Google rating:', error);
                setGoogleRating(prev => ({ ...prev, loading: false }));
            }
        };

        const fetchSearchConsole = async () => {
            try {
                const res = await fetch('/api/reputation/search?period=30');
                const data = await res.json();
                if (data.totals) {
                    setSearchData({ clicks: data.totals.clicks, impressions: data.totals.impressions, position: data.totals.position, loading: false });
                } else {
                    setSearchData(prev => ({ ...prev, loading: false }));
                }
            } catch {
                setSearchData(prev => ({ ...prev, loading: false }));
            }
        };

        const safeFetch = async (url: string, label: string) => {
            try {
                const res = await fetch(url);
                const data = await res.json();
                if (!res.ok) {
                    console.warn(`[Overview] ${label} returned ${res.status}:`, data.error || 'Unknown error');
                }
                return data;
            } catch (err) {
                console.error(`[Overview] ${label} fetch failed:`, err);
                return null;
            }
        };

        const fetchSocial = async () => {
            setSocialLoading(true);

            const [igData, fbData, ytData] = await Promise.all([
                safeFetch(`/api/organic/instagram?period=${period}`, 'Instagram'),
                safeFetch(`/api/organic/facebook?period=${period}`, 'Facebook'),
                safeFetch(`/api/organic/youtube?period=${period}`, 'YouTube'),
            ]);

            setPlatforms(prev => {
                const updated = { ...prev };

                if (igData?.configured && igData?.summary) {
                    setIgDataRaw(igData);
                    updated.Instagram = {
                        followers: formatNumber(igData.summary.followers),
                        engagement: `${igData.summary.engagementRate}%`,
                        configured: true,
                    };
                } else if (igData) {
                    console.warn('[Overview] Instagram not usable:', igData.error || 'No summary data');
                }

                if (fbData?.configured && fbData?.summary) {
                    setFbDataRaw(fbData);
                    updated.Facebook = {
                        followers: formatNumber(fbData.summary.followers),
                        engagement: `${fbData.summary.engagementRate}%`,
                        configured: true,
                    };
                } else if (fbData) {
                    console.warn('[Overview] Facebook not usable:', fbData.error || 'No summary data');
                }

                if (ytData?.configured && ytData?.summary) {
                    updated.YouTube = {
                        followers: formatNumber(ytData.summary.subscribers),
                        engagement: `${ytData.summary.engagementRate}%`,
                        configured: true,
                    };
                } else if (ytData) {
                    console.warn('[Overview] YouTube not usable:', ytData.error || 'No summary data');
                }

                return updated;
            });
            setSocialLoading(false);
        };

        fetchMetrics();
        fetchGoogleRating();
        fetchSearchConsole();
        fetchSocial();
    }, [period]);

    // Compute total followers across connected platforms
    const totalFollowers = (() => {
        let total = 0;
        let hasAny = false;
        for (const p of Object.values(platforms)) {
            if (p.configured) {
                hasAny = true;
                const num = p.followers.replace(/[KMk,]/g, '');
                const parsed = parseFloat(num);
                if (!isNaN(parsed)) {
                    if (p.followers.includes('K') || p.followers.includes('k')) total += parsed * 1000;
                    else if (p.followers.includes('M')) total += parsed * 1_000_000;
                    else total += parsed;
                }
            }
        }
        return hasAny ? formatNumber(Math.round(total)) : '--';
    })();

    // Build trend chart data
    const combinedDaily = (() => {
        if (!igDataRaw?.dailyInsights && !fbDataRaw?.dailyInsights) return [];
        const dateMap = new Map<string, { date: string; igFollowers: number; igReach: number; fbFollowers: number; fbEngagements: number }>();

        for (const d of igDataRaw?.dailyInsights || []) {
            dateMap.set(d.date, {
                date: d.date,
                igFollowers: d.followerCount,
                igReach: d.reach,
                fbFollowers: 0,
                fbEngagements: 0,
            });
        }
        for (const d of fbDataRaw?.dailyInsights || []) {
            const existing = dateMap.get(d.date) || { date: d.date, igFollowers: 0, igReach: 0, fbFollowers: 0, fbEngagements: 0 };
            existing.fbFollowers = d.pageFollows;
            existing.fbEngagements = d.pagePostEngagements;
            dateMap.set(d.date, existing);
        }

        return Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
    })();

    // Generate dynamic Quick Insights
    const generateInsights = () => {
        const insights = [];

        // 1. MindBody Lead Growth
        const leadsNum = parseInt(metrics.leads.val);
        if (!isNaN(leadsNum) && leadsNum > 0) {
            insights.push(`Generated ${leadsNum} new leads in the last ${period}.`);
        } else if (metrics.leads.val !== '--') {
            insights.push(`No new leads tracked in MindBody for the last ${period}. Check attribution logs.`);
        }

        // 2. Cross-platform growth check
        const totalFollowerStr = totalFollowers.replace(/[K,]/g, '');
        if (totalFollowerStr !== '--' && igDataRaw && fbDataRaw) {
            insights.push(`Total audience reach consists of primarily ${igDataRaw?.summary?.followers > fbDataRaw?.summary?.followers ? 'Instagram' : 'Facebook'} followers.`);
        }

        // 3. Highlight biggest organic winner
        let bestEngagementPlatform = '';
        let bestEngagementRate = 0;

        for (const [name, p] of Object.entries(platforms)) {
            if (p.configured && p.engagement !== '--%') {
                const rate = parseFloat(p.engagement);
                if (rate > bestEngagementRate) {
                    bestEngagementRate = rate;
                    bestEngagementPlatform = name;
                }
            }
        }

        if (bestEngagementPlatform) {
            insights.push(`${bestEngagementPlatform} has your highest engagement rate at ${bestEngagementRate.toFixed(2)}%. Focus content efforts here.`);
        }

        return insights;
    };

    const insightsList = generateInsights();

    return (
        <>
            <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
                <div>
                    <h1>Welcome back, {firstName}</h1>
                    <p className="subtitle">Here&apos;s your marketing performance overview</p>
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

            {/* KPI Cards */}
            <div className="metrics-grid" style={{ gridTemplateColumns: `repeat(3, 1fr)` }}>
                <div className="metric-card">
                    <div className="label">Total Followers</div>
                    <div className="value">{socialLoading ? <Skeleton className="h-9 w-24" /> : totalFollowers}</div>
                    <div className="change positive">Across all platforms</div>
                </div>
                <div className="metric-card">
                    <div className="label">Engagement Rate</div>
                    <div className="value">
                        {socialLoading ? <Skeleton className="h-9 w-20" /> : (() => {
                            const rates = Object.values(platforms)
                                .filter(p => p.configured && p.engagement !== '--%')
                                .map(p => parseFloat(p.engagement));
                            return rates.length > 0
                                ? `${(rates.reduce((a, b) => a + b, 0) / rates.length).toFixed(2)}%`
                                : '--%';
                        })()}
                    </div>
                    <div className="change">Weighted average</div>
                </div>
                <div className="metric-card">
                    <div className="label">New Leads</div>
                    <div className="value">{metrics.leads.loading ? <Skeleton className="h-9 w-16" /> : metrics.leads.val}</div>
                    <div className="change">From MindBody</div>
                </div>
            </div>

            {/* Reputation & Search */}
            <div className="section-card">
                <h3>Reputation &amp; Search</h3>
                <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
                    <div className="metric-card" style={{ padding: '16px' }}>
                        <div className="label">Google Rating</div>
                        <div className="value" style={{ fontSize: '1.5rem' }}>
                            {googleRating.loading ? <Skeleton className="h-7 w-14" /> : <>{googleRating.rating} <span style={{ fontSize: '0.75em', color: '#eab308' }}>&#9733;</span></>}
                        </div>
                    </div>
                    <div className="metric-card" style={{ padding: '16px' }}>
                        <div className="label">Total Reviews</div>
                        <div className="value" style={{ fontSize: '1.5rem' }}>
                            {googleRating.loading ? <Skeleton className="h-7 w-14" /> : googleRating.reviews}
                        </div>
                    </div>
                    <div className="metric-card" style={{ padding: '16px' }}>
                        <div className="label">5-Star Rate</div>
                        <div className="value" style={{ fontSize: '1.5rem', color: '#22c55e' }}>
                            {googleRating.loading ? <Skeleton className="h-7 w-14" /> : googleRating.fiveStarRate}
                        </div>
                    </div>
                    <div className="metric-card" style={{ padding: '16px' }}>
                        <div className="label">Search Clicks</div>
                        <div className="value" style={{ fontSize: '1.5rem' }}>
                            {searchData.loading ? <Skeleton className="h-7 w-14" /> : formatNumber(searchData.clicks)}
                        </div>
                        <div className="change">Last 30 days</div>
                    </div>
                    <div className="metric-card" style={{ padding: '16px' }}>
                        <div className="label">Avg Position</div>
                        <div className="value" style={{ fontSize: '1.5rem' }}>
                            {searchData.loading ? <Skeleton className="h-7 w-14" /> : searchData.position.toFixed(1)}
                        </div>
                        <div className="change">Google Search</div>
                    </div>
                </div>
            </div>

            {/* Platform Summary Cards */}
            <div className="section-card">
                <h3>Platform Overview</h3>
                <div className="platform-grid">
                    {[
                        { name: 'Instagram', icon: 'instagram', color: '#E1306C', tab: 'instagram' },
                        { name: 'Facebook', icon: 'facebook', color: '#1877F2', tab: 'facebook' },
                        { name: 'YouTube', icon: 'youtube', color: '#FF0000', tab: 'youtube' },
                    ].map(platform => {
                        const data = platforms[platform.name];
                        return (
                            <a key={platform.name} href={`/organic?tab=${platform.tab}`} className="platform-card" style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer', transition: 'transform 0.2s, box-shadow 0.2s' }}>
                                <div className="platform-card-header">
                                    <div className={`platform-icon ${platform.icon}`}>
                                        <span style={{ color: platform.color }}>{platform.name[0]}</span>
                                    </div>
                                    <div>
                                        <div style={{ fontWeight: 600, fontSize: '0.9375rem' }}>{platform.name}</div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                            {data?.configured ? '@chinupaesthetics' : 'Not connected'}
                                        </div>
                                    </div>
                                </div>
                                <div className="platform-card-stats">
                                    <div className="platform-stat">
                                        <div className="label">Followers</div>
                                        <div className="value">{data?.followers || '--'}</div>
                                    </div>
                                    <div className="platform-stat">
                                        <div className="label">Engagement</div>
                                        <div className="value">{data?.engagement || '--%'}</div>
                                    </div>
                                </div>
                            </a>
                        );
                    })}
                </div>
            </div>

            {/* Trend Charts */}
            {socialLoading ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                    <SkeletonChart height={280} />
                    <SkeletonChart height={280} />
                </div>
            ) : combinedDaily.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                    <div className="chart-container">
                        <div className="chart-header">
                            <h3>Follower Growth</h3>
                            <span className="badge info">{period}</span>
                        </div>
                        <ResponsiveContainer width="100%" height={280}>
                            <LineChart data={combinedDaily} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                <XAxis dataKey="date" tick={{ fill: '#A1A1AA', fontSize: 11 }} tickFormatter={formatDate} />
                                <YAxis tick={{ fill: '#A1A1AA', fontSize: 11 }} tickFormatter={(v) => formatNumber(v)} />
                                <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(label) => formatDate(String(label))} />
                                <Legend wrapperStyle={{ color: '#E4E4E7', fontSize: '0.8125rem' }} />
                                {platforms.Instagram.configured && <Line type="monotone" dataKey="igFollowers" name="IG Followers (New)" stroke="#E1306C" strokeWidth={2} dot={false} />}
                                {platforms.Facebook.configured && <Line type="monotone" dataKey="fbFollowers" name="FB Followers (New)" stroke="#1877F2" strokeWidth={2} dot={false} />}
                            </LineChart>
                        </ResponsiveContainer>
                    </div>

                    <div className="chart-container">
                        <div className="chart-header">
                            <h3>Engagement Trend</h3>
                            <span className="badge info">{period}</span>
                        </div>
                        <ResponsiveContainer width="100%" height={280}>
                            <BarChart data={combinedDaily} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                <XAxis dataKey="date" tick={{ fill: '#A1A1AA', fontSize: 11 }} tickFormatter={formatDate} />
                                <YAxis tick={{ fill: '#A1A1AA', fontSize: 11 }} tickFormatter={(v) => formatNumber(v)} />
                                <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(label) => formatDate(String(label))} />
                                <Legend wrapperStyle={{ color: '#E4E4E7', fontSize: '0.8125rem' }} />
                                {platforms.Instagram.configured && <Bar dataKey="igReach" name="IG Reach" fill="#E1306C" radius={[4, 4, 0, 0]} />}
                                {platforms.Facebook.configured && <Bar dataKey="fbEngagements" name="FB Engagements" fill="#1877F2" radius={[4, 4, 0, 0]} />}
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                    <div className="chart-container">
                        <div className="chart-header">
                            <h3>Follower Growth</h3>
                            <span className="badge info">{period}</span>
                        </div>
                        <div className="empty-state" style={{ padding: '32px' }}>
                            <p>Connect your social accounts to see growth trends</p>
                        </div>
                    </div>
                    <div className="chart-container">
                        <div className="chart-header">
                            <h3>Engagement Trend</h3>
                            <span className="badge info">{period}</span>
                        </div>
                        <div className="empty-state" style={{ padding: '32px' }}>
                            <p>Connect your social accounts to see engagement data</p>
                        </div>
                    </div>
                </div>
            )}

            {/* Quick Insights */}
            <div className="section-card">
                <div className="chart-header" style={{ marginBottom: '16px' }}>
                    <h3>Quick Insights</h3>
                </div>
                {insightsList.length > 0 ? (
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {insightsList.map((insight, idx) => (
                            <li key={idx} style={{
                                padding: '16px',
                                background: 'rgba(255, 255, 255, 0.03)',
                                border: '1px solid var(--border-subtle)',
                                borderRadius: '8px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '12px'
                            }}>
                                <div style={{
                                    width: '8px',
                                    height: '8px',
                                    borderRadius: '50%',
                                    background: 'var(--accent-primary)',
                                    flexShrink: 0
                                }} />
                                <span style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>{insight}</span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <div className="empty-state">
                        <h3>No data yet</h3>
                        <p>Once your social accounts and ad platforms are connected, insights will appear here automatically.</p>
                        {isAdmin && (
                            <p style={{ marginTop: '12px' }}>
                                Go to <strong>Settings</strong> to connect your accounts.
                            </p>
                        )}
                    </div>
                )}
            </div>
        </>
    );
}
