'use client';

import { useSession } from 'next-auth/react';
import { useState, useEffect } from 'react';
import { Skeleton, SkeletonChart } from '@/components/Skeleton';
import { formatNumber, formatDate } from '@/lib/format';
import { TOOLTIP_STYLE, PLATFORM_COLORS, AXIS_PROPS, GRID_PROPS } from '@/lib/constants';

import {
    LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

type Period = '7d' | '30d' | '90d';

interface PlatformData {
    followers: string;
    followerCount: number;
    engagement: string;
    configured: boolean;
}

export default function OverviewPage() {
    const { data: session } = useSession();
    const [period, setPeriod] = useState<Period>('30d');
    const [metrics, setMetrics] = useState({
        leads: { val: '--', loading: true },
    });
    const [platforms, setPlatforms] = useState<Record<string, PlatformData>>({
        Instagram: { followers: '--', followerCount: 0, engagement: '--%', configured: false },
        Facebook: { followers: '--', followerCount: 0, engagement: '--%', configured: false },
        YouTube: { followers: '--', followerCount: 0, engagement: '--%', configured: false },
    });

    const [igDataRaw, setIgDataRaw] = useState<any>(null);
    const [fbDataRaw, setFbDataRaw] = useState<any>(null);
    const [socialLoading, setSocialLoading] = useState(true);
    // error = the source failed; render "Unavailable", never a number
    const [googleRating, setGoogleRating] = useState<{ rating: string; reviews: string; loading: boolean; error: boolean }>({ rating: '--', reviews: '--', loading: true, error: false });
    const [searchData, setSearchData] = useState<{ clicks: number; impressions: number; position: number; loading: boolean; error: boolean }>({ clicks: 0, impressions: 0, position: 0, loading: true, error: false });

    const user = session?.user as Record<string, unknown> | undefined;
    const isAdmin = user?.isAdmin === true;
    const displayName = (user?.name as string) || 'there';
    const firstName = displayName.split(' ')[0];

    useEffect(() => {
        const fetchMetrics = async () => {
            setMetrics({ leads: { val: '--', loading: true } });

            try {
                const res = await fetch(`/api/metrics/leads?period=${period}`);
                const leadsData = await res.json();
                if (!res.ok || typeof leadsData.count !== 'number') throw new Error(leadsData.error || `HTTP ${res.status}`);
                setMetrics({
                    leads: { val: leadsData.count.toString(), loading: false },
                });
            } catch (error) {
                console.error('[Overview] Failed to fetch leads:', error);
                setMetrics({
                    leads: { val: 'Unavailable', loading: false },
                });
            }
        };

        const fetchGoogleRating = async () => {
            try {
                const res = await fetch('/api/reputation/reviews?location=all');
                const data = await res.json();
                if (!res.ok || !data.metrics) throw new Error(data.error || `HTTP ${res.status}`);
                setGoogleRating({
                    rating: data.metrics.averageRating.toFixed(1),
                    reviews: data.metrics.totalReviews.toLocaleString(),
                    loading: false,
                    error: false,
                });
            } catch (error) {
                console.error('[Overview] Failed to fetch Google rating:', error);
                setGoogleRating(prev => ({ ...prev, loading: false, error: true }));
            }
        };

        const fetchSearchConsole = async () => {
            try {
                const res = await fetch('/api/reputation/search?period=30');
                const data = await res.json();
                if (!res.ok || !data.totals) throw new Error(data.error || `HTTP ${res.status}`);
                setSearchData({ clicks: data.totals.clicks, impressions: data.totals.impressions, position: data.totals.position, loading: false, error: false });
            } catch (error) {
                console.error('[Overview] Failed to fetch Search Console:', error);
                setSearchData(prev => ({ ...prev, loading: false, error: true }));
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
                        followerCount: igData.summary.followers,
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
                        followerCount: fbData.summary.followers,
                        engagement: `${fbData.summary.engagementRate}%`,
                        configured: true,
                    };
                } else if (fbData) {
                    console.warn('[Overview] Facebook not usable:', fbData.error || 'No summary data');
                }

                if (ytData?.configured && ytData?.summary) {
                    updated.YouTube = {
                        followers: formatNumber(ytData.summary.subscribers),
                        followerCount: ytData.summary.subscribers,
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

    // Compute total followers across connected platforms, from raw counts
    const connected = Object.values(platforms).filter(p => p.configured);
    const totalFollowers = connected.length > 0
        ? connected.reduce((sum, p) => sum + p.followerCount, 0).toLocaleString()
        : '--';

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

        // 1. New paying patients (first purchase in the window, Zenoti + frozen MindBody history)
        const leadsNum = parseInt(metrics.leads.val);
        if (!isNaN(leadsNum) && leadsNum > 0) {
            insights.push(`${leadsNum} new paying patients in the last ${period}.`);
        } else if (leadsNum === 0) {
            insights.push(`No new paying patients in Zenoti for the last ${period}.`);
        }

        // 2. Cross-platform growth check
        const totalFollowerStr = totalFollowers.replace(/[K,]/g, '');
        if (totalFollowerStr !== '--' && igDataRaw && fbDataRaw) {
            insights.push(`Total audience reach consists of primarily ${igDataRaw?.summary?.followers > fbDataRaw?.summary?.followers ? 'Instagram' : 'Facebook'} followers.`);
        }

        return insights;
    };

    const insightsList = generateInsights();

    return (
        <>
            <div className="page-header page-header-row">
                <div>
                    <h1>Welcome back, {firstName}</h1>
                    <p className="subtitle">Here&apos;s your marketing performance overview</p>
                </div>
                <div className="period-selector" role="group" aria-label="Time period">
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
            <div className="metrics-grid kpi-grid md:grid-cols-3">
                <div className="metric-card">
                    <div className="label">Total Followers</div>
                    <div className="value">{socialLoading ? <Skeleton className="h-9 w-24" /> : totalFollowers}</div>
                    <div className="change">Across all platforms</div>
                </div>
                <div className="metric-card">
                    <div className="label">Instagram Engagement Rate</div>
                    <div className="value">
                        {socialLoading ? <Skeleton className="h-9 w-20" /> : (platforms.Instagram.configured ? platforms.Instagram.engagement : 'Unavailable')}
                    </div>
                    <div className="change">Interactions ÷ accounts reached</div>
                </div>
                <div className="metric-card">
                    <div className="label">New Paying Patients</div>
                    <div className="value">{metrics.leads.loading ? <Skeleton className="h-9 w-16" /> : metrics.leads.val}</div>
                    <div className="change">First purchase · last {period === '7d' ? 7 : period === '90d' ? 90 : 30} days · Zenoti</div>
                </div>
            </div>

            {/* Reputation & Search */}
            <div className="section-card">
                <h3>Reputation &amp; Search</h3>
                <div className="stat-grid">
                    <div className="stat">
                        <div className="stat-label">Google Rating</div>
                        <div className="stat-value">
                            {googleRating.loading ? <Skeleton className="h-7 w-14" /> : googleRating.error ? 'Unavailable' : <>{googleRating.rating} <span style={{ fontSize: '0.75em', color: 'var(--accent-primary)' }}>&#9733;</span></>}
                        </div>
                    </div>
                    <div className="stat">
                        <div className="stat-label">Total Reviews</div>
                        <div className="stat-value">
                            {googleRating.loading ? <Skeleton className="h-7 w-14" /> : googleRating.error ? 'Unavailable' : googleRating.reviews}
                        </div>
                    </div>
                    <div className="stat">
                        <div className="stat-label">Search Clicks</div>
                        <div className="stat-value">
                            {searchData.loading ? <Skeleton className="h-7 w-14" /> : searchData.error ? 'Unavailable' : searchData.clicks.toLocaleString()}
                        </div>
                        <div className="stat-sub">Last 30 days</div>
                    </div>
                    <div className="stat">
                        <div className="stat-label">Avg Position</div>
                        <div className="stat-value">
                            {searchData.loading ? <Skeleton className="h-7 w-14" /> : searchData.error ? 'Unavailable' : searchData.position.toFixed(1)}
                        </div>
                        <div className="stat-sub">Google Search</div>
                    </div>
                </div>
            </div>

            {/* Platform Summary Cards */}
            <div className="section-card">
                <h3>Platform Overview</h3>
                <div className="platform-grid">
                    {[
                        { name: 'Instagram', icon: 'instagram', color: PLATFORM_COLORS.instagram, tab: 'instagram' },
                        { name: 'Facebook', icon: 'facebook', color: PLATFORM_COLORS.facebook, tab: 'facebook' },
                        { name: 'YouTube', icon: 'youtube', color: PLATFORM_COLORS.youtube, tab: 'youtube' },
                    ].map(platform => {
                        const data = platforms[platform.name];
                        return (
                            <a key={platform.name} href={`/organic?tab=${platform.tab}`} className="platform-card">
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
                <div className="chart-grid">
                    <SkeletonChart height={280} />
                    <SkeletonChart height={280} />
                </div>
            ) : combinedDaily.length > 0 ? (
                <div className="chart-grid">
                    <div className="chart-container">
                        <div className="chart-header">
                            <h3>Follower Growth</h3>
                            <span className="badge info">{period}</span>
                        </div>
                        <ResponsiveContainer width="100%" height={280}>
                            <LineChart data={combinedDaily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                <CartesianGrid {...GRID_PROPS} />
                                <XAxis dataKey="date" {...AXIS_PROPS} tickFormatter={formatDate} minTickGap={16} />
                                <YAxis {...AXIS_PROPS} width={44} tickFormatter={(v) => formatNumber(v)} />
                                <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(255,255,255,0.04)' }} labelFormatter={(label) => formatDate(String(label))} />
                                <Legend iconType="circle" iconSize={8} wrapperStyle={{ color: '#E4E4E7', fontSize: '0.8125rem', paddingTop: 8 }} />
                                {platforms.Instagram.configured && <Line type="monotone" dataKey="igFollowers" name="IG New Follows" stroke={PLATFORM_COLORS.instagram} strokeWidth={2} dot={false} />}
                                {platforms.Facebook.configured && <Line type="monotone" dataKey="fbFollowers" name="FB Followers (New)" stroke={PLATFORM_COLORS.facebook} strokeWidth={2} dot={false} />}
                            </LineChart>
                        </ResponsiveContainer>
                    </div>

                    <div className="chart-container">
                        <div className="chart-header">
                            <h3>Engagement Trend</h3>
                            <span className="badge info">{period}</span>
                        </div>
                        <ResponsiveContainer width="100%" height={280}>
                            <BarChart data={combinedDaily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                <CartesianGrid {...GRID_PROPS} />
                                <XAxis dataKey="date" {...AXIS_PROPS} tickFormatter={formatDate} minTickGap={16} />
                                <YAxis {...AXIS_PROPS} width={44} tickFormatter={(v) => formatNumber(v)} />
                                <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(255,255,255,0.04)' }} labelFormatter={(label) => formatDate(String(label))} />
                                <Legend iconType="circle" iconSize={8} wrapperStyle={{ color: '#E4E4E7', fontSize: '0.8125rem', paddingTop: 8 }} />
                                {platforms.Instagram.configured && <Bar dataKey="igReach" name="IG Reach" fill={PLATFORM_COLORS.instagram} radius={[4, 4, 0, 0]} />}
                                {platforms.Facebook.configured && <Bar dataKey="fbEngagements" name="FB Engagements" fill={PLATFORM_COLORS.facebook} radius={[4, 4, 0, 0]} />}
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            ) : (
                <div className="chart-grid">
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
                <h3>Quick Insights</h3>
                {insightsList.length > 0 ? (
                    <ul className="insight-list">
                        {insightsList.map((insight, idx) => (
                            <li key={idx}>{insight}</li>
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
