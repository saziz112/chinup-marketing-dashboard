'use client';

import { useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { useState, useEffect, useCallback } from 'react';
import { SkeletonKpiCard, SkeletonChart } from '@/components/Skeleton';
import {
    LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, Legend, Cell,
} from 'recharts';
import { formatNumber, formatDate } from '@/lib/format';
import { TOOLTIP_STYLE } from '@/lib/constants';
import {
    type Period, type PlatformTab, type IGData, type YTData, type FBData, type RepurposingData,
    YouTubeTab, InboxTab, RepurposingTab,
    IGScorecard, ContentMixBar, CoachingBanner, CoachingPanel, TopBottomPosts, ActiveStories,
} from '@/components/organic/OrganicHelpers';
import { generateCoachingPlan } from '@/lib/ig-coaching';
import { generateFBCoachingPlan } from '@/lib/fb-coaching';
import { generateYTCoachingPlan } from '@/lib/yt-coaching';
import { generateAllPlatformsInsights } from '@/lib/all-platforms-insights';
import MetaTokenBanner from '@/components/MetaTokenBanner';

const PLATFORMS: PlatformTab[] = ['All Platforms', 'Instagram', 'Inbox', 'Facebook', 'YouTube', 'Repurposing'];

export default function OrganicPage() {
    const { data: session } = useSession();
    const searchParams = useSearchParams();

    // Read ?tab= query param from URL (e.g., from Overview platform cards)
    const getInitialTab = (): PlatformTab => {
        const tab = searchParams.get('tab');
        const map: Record<string, PlatformTab> = {
            instagram: 'Instagram',
            inbox: 'Inbox',
            facebook: 'Facebook',
            youtube: 'YouTube',
            repurposing: 'Repurposing',
        };
        return map[tab || ''] || 'All Platforms';
    };

    const [activeTab, setActiveTab] = useState<PlatformTab>(getInitialTab);
    const [period, setPeriod] = useState<Period>('30d');
    const [loading, setLoading] = useState(true);
    const [lastFetched, setLastFetched] = useState<Date | null>(null);

    const [igData, setIGData] = useState<IGData | null>(null);
    const [fbData, setFBData] = useState<FBData | null>(null);
    const [ytData, setYTData] = useState<YTData | null>(null);

    // Repurposing tab state (lazy-loaded on tab open)
    const [repurposingData, setRepurposingData] = useState<RepurposingData | null>(null);
    const [repurposingLoading, setRepurposingLoading] = useState(false);
    const [repurposingFetched, setRepurposingFetched] = useState(false);

    // IG posts table state (Phase 2 — sort + filter)
    type IGSortKey = 'timestamp' | 'engagementRate' | 'reach' | 'views' | 'likeCount' | 'commentsCount' | 'shares' | 'saved';
    type IGFilter = 'all' | 'reels' | 'carousels' | 'photos';
    const [igSortKey, setIGSortKey] = useState<IGSortKey>('timestamp');
    const [igSortOrder, setIGSortOrder] = useState<'asc' | 'desc'>('desc');
    const [igFilter, setIGFilter] = useState<IGFilter>('all');

    const fetchData = useCallback(async (force = false) => {
        setLoading(true);
        const forceSuffix = force ? '&force=true' : '';

        const [igRes, fbRes, ytRes] = await Promise.allSettled([
            fetch(`/api/organic/instagram?period=${period}${forceSuffix}`).then(r => r.json()),
            fetch(`/api/organic/facebook?period=${period}${forceSuffix}`).then(r => r.json()),
            fetch(`/api/organic/youtube?period=${period}${forceSuffix}`).then(r => r.json()),
        ]);

        setIGData(igRes.status === 'fulfilled' ? igRes.value : null);
        setFBData(fbRes.status === 'fulfilled' ? fbRes.value : null);
        setYTData(ytRes.status === 'fulfilled' ? ytRes.value : null);
        setLastFetched(new Date());
        setLoading(false);
    }, [period]);

    useEffect(() => {
        if (session) fetchData();
    }, [session, fetchData]);

    // Lazy-fetch repurposing data only when Repurposing tab is first selected
    useEffect(() => {
        if (activeTab === 'Repurposing' && !repurposingFetched && !repurposingLoading) {
            setRepurposingLoading(true);
            fetch('/api/organic/repurposing')
                .then(r => r.json())
                .then(data => { setRepurposingData(data); setRepurposingFetched(true); })
                .catch(() => { setRepurposingData({ configured: false, error: 'Failed to load' }); })
                .finally(() => setRepurposingLoading(false));
        }
    }, [activeTab, repurposingFetched, repurposingLoading]);

    const igConfigured = igData?.configured && !igData?.error;
    const fbConfigured = fbData?.configured && !fbData?.error;
    const ytConfigured = ytData?.configured && !ytData?.error;

    // Combined daily data for "All Platforms" view
    const combinedDaily = (() => {
        if (!igData?.dailyInsights && !fbData?.dailyInsights) return [];
        const dateMap = new Map<string, { date: string; igReach: number; fbVideoViews: number; fbEngagements: number }>();

        for (const d of igData?.dailyInsights || []) {
            dateMap.set(d.date, {
                date: d.date,
                igReach: d.reach,
                fbVideoViews: 0,
                fbEngagements: 0,
            });
        }
        for (const d of fbData?.dailyInsights || []) {
            const existing = dateMap.get(d.date) || { date: d.date, igReach: 0, fbVideoViews: 0, fbEngagements: 0 };
            existing.fbVideoViews = d.pageVideoViews;
            existing.fbEngagements = d.pagePostEngagements;
            dateMap.set(d.date, existing);
        }

        return Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
    })();

    const renderNotConnected = (platform: string) => (
        <div className="section-card">
            <div className="empty-state">
                <h3>{platform} not connected</h3>
                <p>Add your {platform === 'YouTube' ? 'Google' : 'Meta'} API credentials to .env.local to see {platform} data.</p>
            </div>
        </div>
    );

    const renderError = (platform: string, errorMsg: string) => (
        <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '1.5rem', borderRadius: '12px', marginBottom: '2rem' }}>
            <h3 style={{ color: '#ef4444', margin: '0 0 0.5rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span>⚠️</span> Error Loading {platform}
            </h3>
            <p style={{ color: 'var(--text-muted)', margin: 0 }}>{errorMsg}</p>
        </div>
    );

    // --- All Platforms View ---
    const renderAllPlatforms = () => {
        if (!igConfigured && !fbConfigured && !ytConfigured) {
            return (
                <div className="section-card">
                    <div className="empty-state">
                        <h3>No platforms connected</h3>
                        <p>Connect your social media accounts to see organic performance data.</p>
                    </div>
                </div>
            );
        }

        // Compute cross-platform insights
        const insights = generateAllPlatformsInsights({
            ig: igConfigured && igData?.summary && igData?.cadence
                ? {
                    configured: true,
                    engagementRate: igData.summary.engagementRate,
                    followers: igData.summary.followers,
                    followerChangePercent: igData.summary.followerChangePercent,
                    reelsPerWeek: igData.cadence.reelsPerWeek,
                    feedPostsPerWeek: igData.cadence.feedPostsPerWeek,
                }
                : null,
            fb: fbConfigured && fbData?.summary
                ? {
                    configured: true,
                    engagementRate: fbData.summary.engagementRate,
                    followers: fbData.summary.followers,
                    followerChangePercent: fbData.summary.followerChangePercent,
                    videoViews: fbData.summary.totalVideoViews,
                }
                : null,
            yt: ytConfigured && ytData?.summary
                ? {
                    configured: true,
                    engagementRate: ytData.summary.engagementRate,
                    subscribers: ytData.summary.subscribers,
                    videosInPeriod: ytData.videosInPeriod || 0,
                    avgViewsPerVideo: ytData.summary.avgViewsPerVideo,
                }
                : null,
        });

        // Honest aggregates
        const totalFollowers = (igData?.summary?.followers || 0) + (fbData?.summary?.followers || 0) + (ytData?.summary?.subscribers || 0);
        const totalEngagement = (igData?.summary?.totalInteractions || 0) + (fbData?.summary?.totalEngagements || 0) + (ytData?.summary?.recentVideoLikes || 0) + (ytData?.summary?.recentVideoComments || 0);

        // Weighted follower-growth: weight each platform's % by its follower count
        const followerGrowthWeighted = (() => {
            const parts: Array<{ pct: number; w: number }> = [];
            if (igData?.summary) parts.push({ pct: igData.summary.followerChangePercent, w: igData.summary.followers });
            if (fbData?.summary) parts.push({ pct: fbData.summary.followerChangePercent, w: fbData.summary.followers });
            // YT doesn't expose subscriber change
            const totalW = parts.reduce((s, p) => s + p.w, 0);
            if (totalW === 0) return 0;
            return Math.round((parts.reduce((s, p) => s + p.pct * p.w, 0) / totalW) * 100) / 100;
        })();

        // Comparison chart data — engagement rate per platform
        const comparisonData = insights.healthByPlatform.map(h => ({
            platform: h.label,
            engagementRate: h.primaryEngagementRate,
            healthScore: Math.round(h.score),
            color: h.color,
        }));

        return (
            <>
                {/* "Where to Focus" coaching panel */}
                {insights.whereToFocus && (
                    <div className="section-card" style={{
                        marginBottom: 24,
                        background: `linear-gradient(135deg, ${insights.whereToFocus.targetPlatform === 'instagram' ? 'rgba(225,48,108,0.06)' : insights.whereToFocus.targetPlatform === 'facebook' ? 'rgba(24,119,242,0.06)' : 'rgba(255,0,0,0.05)'} 0%, rgba(168,139,250,0.04) 100%)`,
                        border: '1px solid rgba(168, 139, 250, 0.2)',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                            <span style={{ fontSize: 20, lineHeight: '24px' }}>★</span>
                            <div style={{ flex: 1 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                                    <strong style={{ color: 'var(--text-primary)', fontSize: 15 }}>Where to Focus</strong>
                                    <span style={{
                                        fontSize: 10, padding: '2px 8px', borderRadius: 999,
                                        background: 'rgba(168, 139, 250, 0.15)', color: '#a78bfa', fontWeight: 600,
                                    }}>RECOMMENDATION</span>
                                </div>
                                <h4 style={{ margin: '4px 0 4px 0', color: 'var(--text-primary)' }}>{insights.whereToFocus.title}</h4>
                                <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 8px 0', lineHeight: 1.5 }}>
                                    {insights.whereToFocus.body}
                                </p>
                                <div style={{
                                    color: 'var(--text-primary)', fontSize: 13, padding: '8px 12px',
                                    background: 'rgba(255,255,255,0.04)', borderRadius: 6,
                                    borderLeft: '3px solid #a78bfa',
                                }}>
                                    <strong style={{ color: '#a78bfa' }}>Action:</strong> {insights.whereToFocus.suggestedAction}
                                </div>
                            </div>
                            <button
                                onClick={() => setActiveTab(insights.whereToFocus!.targetPlatform === 'instagram' ? 'Instagram' : insights.whereToFocus!.targetPlatform === 'facebook' ? 'Facebook' : 'YouTube')}
                                style={{
                                    background: '#a78bfa', color: 'white', border: 'none',
                                    padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                                    cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                                }}
                            >
                                Open →
                            </button>
                        </div>
                    </div>
                )}

                {/* Top KPI cards */}
                <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                    <div className="metric-card" title="Sum of followers across all connected platforms">
                        <div className="label">Total Followers</div>
                        <div className="value">{formatNumber(totalFollowers)}</div>
                        <div className={`change ${followerGrowthWeighted >= 0 ? 'positive' : 'negative'}`}>
                            {followerGrowthWeighted >= 0 ? '+' : ''}{followerGrowthWeighted}% weighted
                        </div>
                    </div>
                    <div className="metric-card" title="Total interactions: IG (likes+comments+shares+saves) + FB engagements + YT likes+comments">
                        <div className="label">Total Engagement</div>
                        <div className="value">{formatNumber(totalEngagement)}</div>
                        <div className="change">All interactions</div>
                    </div>
                    <div className="metric-card" title={insights.bestPlatform ? `Highest health score across configured platforms (${Math.round(insights.bestPlatform.score)}/100)` : ''}>
                        <div className="label">Best Platform</div>
                        <div className="value" style={{ color: insights.bestPlatform?.color || 'var(--text-primary)' }}>
                            {insights.bestPlatform?.label || '—'}
                        </div>
                        <div className="change">
                            {insights.bestPlatform ? `${Math.round(insights.bestPlatform.score)}/100 health · ${insights.bestPlatform.primaryEngagementRate}% ER` : ''}
                        </div>
                    </div>
                    <div className="metric-card" title="Platform with highest output cadence right now">
                        <div className="label">Most Active</div>
                        <div className="value">{insights.mostActivePlatform?.label || '—'}</div>
                        <div className="change">{insights.mostActivePlatform?.activityLabel || ''}</div>
                    </div>
                </div>

                {/* Platform Summary Cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
                    {igConfigured && igData?.summary && (() => {
                        const igHealth = insights.healthByPlatform.find(h => h.key === 'instagram');
                        return (
                        <div className={`section-card ${activeTab === 'Instagram' ? 'active-tab-card' : ''}`} style={{ cursor: 'pointer', borderColor: activeTab === 'Instagram' ? 'var(--accent-primary)' : 'var(--border)' }} onClick={() => setActiveTab('Instagram')}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                                <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(225, 48, 108, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: '1rem', color: '#E1306C' }}>I</div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 600 }}>Instagram</div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>@{igData.profile?.username}</div>
                                </div>
                                {igHealth && (
                                    <span title={`Health: ${igHealth.grade.label} (${Math.round(igHealth.score)}/100)`} style={{
                                        width: 10, height: 10, borderRadius: '50%', background: igHealth.grade.color, flexShrink: 0,
                                    }} />
                                )}
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                                <div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Followers</div>
                                    <div style={{ fontWeight: 700, fontSize: '1.125rem' }}>{formatNumber(igData.summary.followers)}</div>
                                    <div style={{ fontSize: '0.6875rem', color: igData.summary.followerChange >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                                        {igData.summary.followerChange >= 0 ? '+' : ''}{formatNumber(igData.summary.followerChange)}
                                    </div>
                                </div>
                                <div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Reach</div>
                                    <div style={{ fontWeight: 700, fontSize: '1.125rem' }}>{formatNumber(igData.summary.totalReach)}</div>
                                </div>
                                <div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Engagement</div>
                                    <div style={{ fontWeight: 700, fontSize: '1.125rem' }}>{igData.summary.engagementRate}%</div>
                                </div>
                            </div>
                        </div>
                    );})()}

                    {fbConfigured && fbData?.summary && (() => {
                        const fbHealth = insights.healthByPlatform.find(h => h.key === 'facebook');
                        return (
                        <div className={`section-card ${activeTab === 'Facebook' ? 'active-tab-card' : ''}`} style={{ cursor: 'pointer', borderColor: activeTab === 'Facebook' ? 'var(--accent-primary)' : 'var(--border)' }} onClick={() => setActiveTab('Facebook')}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                                <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(24, 119, 242, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: '1rem', color: '#1877F2' }}>F</div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 600 }}>Facebook</div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{fbData.page?.name}</div>
                                </div>
                                {fbHealth && (
                                    <span title={`Health: ${fbHealth.grade.label} (${Math.round(fbHealth.score)}/100)`} style={{
                                        width: 10, height: 10, borderRadius: '50%', background: fbHealth.grade.color, flexShrink: 0,
                                    }} />
                                )}
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                                <div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Followers</div>
                                    <div style={{ fontWeight: 700, fontSize: '1.125rem' }}>{formatNumber(fbData.summary.followers)}</div>
                                    <div style={{ fontSize: '0.6875rem', color: fbData.summary.followerChange >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                                        {fbData.summary.followerChange >= 0 ? '+' : ''}{formatNumber(fbData.summary.followerChange)}
                                    </div>
                                </div>
                                <div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Views</div>
                                    <div style={{ fontWeight: 700, fontSize: '1.125rem' }}>{formatNumber(fbData.summary.totalVideoViews)}</div>
                                </div>
                                <div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Engagement</div>
                                    <div style={{ fontWeight: 700, fontSize: '1.125rem' }}>{fbData.summary.engagementRate}%</div>
                                </div>
                            </div>
                        </div>
                    );})()}

                    {ytConfigured && ytData?.summary && (() => {
                        const ytHealth = insights.healthByPlatform.find(h => h.key === 'youtube');
                        return (
                        <div className={`section-card ${activeTab === 'YouTube' ? 'active-tab-card' : ''}`} style={{ cursor: 'pointer', borderColor: activeTab === 'YouTube' ? 'var(--accent-primary)' : 'var(--border)' }} onClick={() => setActiveTab('YouTube')}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                                <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(255, 0, 0, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: '1rem', color: '#FF0000' }}>Y</div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 600 }}>YouTube</div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{ytData.channel?.title}</div>
                                </div>
                                {ytHealth && (
                                    <span title={`Health: ${ytHealth.grade.label} (${Math.round(ytHealth.score)}/100)`} style={{
                                        width: 10, height: 10, borderRadius: '50%', background: ytHealth.grade.color, flexShrink: 0,
                                    }} />
                                )}
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                                <div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Subscribers</div>
                                    <div style={{ fontWeight: 700, fontSize: '1.125rem' }}>{formatNumber(ytData.summary.subscribers)}</div>
                                    <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                                        {ytData.videosInPeriod || 0} videos / {period}
                                    </div>
                                </div>
                                <div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Views</div>
                                    <div style={{ fontWeight: 700, fontSize: '1.125rem' }}>{formatNumber(ytData.summary.recentVideoViews)}</div>
                                </div>
                                <div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Engagement</div>
                                    <div style={{ fontWeight: 700, fontSize: '1.125rem' }}>{ytData.summary.engagementRate}%</div>
                                </div>
                            </div>
                        </div>
                    );})()}

                </div>

                {/* Platform Comparison Chart — engagement rate side-by-side */}
                {comparisonData.length > 0 && (
                    <div className="chart-container">
                        <div className="chart-header">
                            <h3>Platform Comparison — Engagement Rate</h3>
                            <span className="badge info">{period}</span>
                        </div>
                        <ResponsiveContainer width="100%" height={240}>
                            <BarChart data={comparisonData} margin={{ top: 16, right: 20, left: 10, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                <XAxis dataKey="platform" tick={{ fill: '#A1A1AA', fontSize: 12 }} />
                                <YAxis tick={{ fill: '#A1A1AA', fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                                <Tooltip
                                    contentStyle={TOOLTIP_STYLE}
                                    formatter={(value) => [`${value}%`, 'ER']}
                                />
                                <Bar dataKey="engagementRate" radius={[4, 4, 0, 0]}>
                                    {comparisonData.map((d, i) => (
                                        <Cell key={i} fill={d.color} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                        <div style={{ display: 'flex', justifyContent: 'space-around', marginTop: 8, flexWrap: 'wrap', gap: 12 }}>
                            {comparisonData.map(d => (
                                <div key={d.platform} style={{ textAlign: 'center', fontSize: 11 }}>
                                    <div style={{ color: d.color, fontWeight: 600 }}>{d.platform}</div>
                                    <div style={{ color: 'var(--text-muted)' }}>Health: {d.healthScore}/100</div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </>
        );
    };

    // --- Instagram Tab ---
    const renderInstagram = () => {
        if (igData?.error) return renderError('Instagram', igData.error);
        if (!igConfigured) return renderNotConnected('Instagram');
        const s = igData!.summary!;
        const deltas = igData!.deltas;
        const cadence = igData!.cadence;
        const contentMix = igData!.contentMix;
        const stories = igData!.stories || [];
        const commentReplyStats = igData!.commentReplyStats;
        const insights = igData!.dailyInsights || [];
        const posts = igData!.posts || [];

        // Render delta change line ("+12.3% vs prev")
        const renderDelta = (pct: number | undefined): React.ReactNode => {
            if (pct === undefined || pct === null) return null;
            const positive = pct >= 0;
            return (
                <span className={positive ? 'positive' : 'negative'}>
                    {positive ? '+' : ''}{pct}% vs prev
                </span>
            );
        };

        // Filter + sort posts for the table
        const filteredPosts = posts.filter(p => {
            if (igFilter === 'all') return true;
            if (igFilter === 'reels') return p.mediaType === 'VIDEO';
            if (igFilter === 'carousels') return p.mediaType === 'CAROUSEL_ALBUM';
            if (igFilter === 'photos') return p.mediaType === 'IMAGE';
            return true;
        });
        const sortedPosts = [...filteredPosts].sort((a, b) => {
            const av = igSortKey === 'timestamp' ? new Date(a.timestamp).getTime() : (a as any)[igSortKey] || 0;
            const bv = igSortKey === 'timestamp' ? new Date(b.timestamp).getTime() : (b as any)[igSortKey] || 0;
            return igSortOrder === 'asc' ? av - bv : bv - av;
        });
        const handleSort = (key: IGSortKey) => {
            if (igSortKey === key) {
                setIGSortOrder(igSortOrder === 'asc' ? 'desc' : 'asc');
            } else {
                setIGSortKey(key);
                setIGSortOrder('desc');
            }
        };
        const sortIndicator = (key: IGSortKey) => igSortKey === key ? (igSortOrder === 'asc' ? ' ▲' : ' ▼') : '';

        return (
            <>
                {/* Coaching + Health Scorecard */}
                {cadence && (
                    <>
                        <CoachingBanner cadence={cadence} summary={s} deltas={deltas} commentReplyStats={commentReplyStats} />
                        <CoachingPanel
                            platformLabel="Instagram"
                            plan={generateCoachingPlan({
                                reelsPerWeek: cadence.reelsPerWeek,
                                feedPostsPerWeek: cadence.feedPostsPerWeek,
                                carouselMixPercent: cadence.carouselMixPercent,
                                storiesActive: cadence.storiesActive,
                                engagementRate: s.engagementRate,
                                saveRate: s.saveRate,
                                sendRate: s.sendRate,
                                replyRate: commentReplyStats?.replyRate,
                                avgReplyHours: commentReplyStats?.avgResponseHours,
                                totalComments: commentReplyStats?.totalComments,
                                followerChange: s.followerChange,
                                followerChangePercent: s.followerChangePercent,
                            })}
                            aiPlan={igData!.aiCoachingPlan}
                        />
                        <IGScorecard cadence={cadence} summary={s} deltas={deltas} commentReplyStats={commentReplyStats} />
                        {contentMix && <ContentMixBar contentMix={contentMix} />}
                    </>
                )}

                {/* KPI Cards — Views leads (Meta primary metric since April 2025) */}
                <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                    <div className="metric-card" title="Total profile followers">
                        <div className="label">Followers</div>
                        <div className="value">{formatNumber(s.followers)}</div>
                        <div className={`change ${s.followerChange >= 0 ? 'positive' : 'negative'}`}>
                            {s.followerChange >= 0 ? '+' : ''}{formatNumber(s.followerChange)} ({s.followerChangePercent}%)
                        </div>
                    </div>
                    <div className="metric-card" title="Meta's primary metric since April 2025 — strongest algorithm signal across Reels, Stories, carousels, and photos">
                        <div className="label">Views</div>
                        <div className="value">{formatNumber(s.totalViews)}</div>
                        <div className="change">{renderDelta(deltas?.viewsPct) || 'Total content views'}</div>
                    </div>
                    <div className="metric-card" title="Unique accounts that saw content (one count per person, regardless of repeat exposures)">
                        <div className="label">Reach</div>
                        <div className="value">{formatNumber(s.totalReach)}</div>
                        <div className="change">{renderDelta(deltas?.reachPct) || 'Unique accounts'}</div>
                    </div>
                    <div className="metric-card" title="Interactions (likes + comments + shares + saves) divided by reach. 2026 industry: 1–2% avg, 3–6% good, 6%+ excellent.">
                        <div className="label">Engagement Rate</div>
                        <div className="value">{s.engagementRate}%</div>
                        <div className="change">{renderDelta(deltas?.engagementRatePct) || 'Interactions / Reach'}</div>
                    </div>
                </div>

                {/* Daily Charts */}
                {insights.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                        <div className="chart-container">
                            <div className="chart-header">
                                <h3>Daily Reach</h3>
                            </div>
                            <ResponsiveContainer width="100%" height={280}>
                                <LineChart data={insights} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                    <XAxis dataKey="date" tick={{ fill: '#A1A1AA', fontSize: 11 }} tickFormatter={formatDate} />
                                    <YAxis tick={{ fill: '#A1A1AA', fontSize: 11 }} tickFormatter={(v) => formatNumber(v)} />
                                    <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(label) => formatDate(String(label))} />
                                    <Legend wrapperStyle={{ color: '#E4E4E7', fontSize: '0.8125rem' }} />
                                    <Line type="monotone" dataKey="reach" name="Reach" stroke="#E1306C" strokeWidth={2} dot={false} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>

                        <div className="chart-container">
                            <div className="chart-header">
                                <h3>Daily Follower Growth</h3>
                            </div>
                            <ResponsiveContainer width="100%" height={280}>
                                <BarChart data={insights} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                    <XAxis dataKey="date" tick={{ fill: '#A1A1AA', fontSize: 11 }} tickFormatter={formatDate} />
                                    <YAxis tick={{ fill: '#A1A1AA', fontSize: 11 }} />
                                    <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(label) => formatDate(String(label))} />
                                    <Legend wrapperStyle={{ color: '#E4E4E7', fontSize: '0.8125rem' }} />
                                    <Bar dataKey="followerCount" name="New Followers" fill="#E1306C" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                )}

                {/* Active Stories */}
                <ActiveStories stories={stories} />

                {/* Top / Bottom Posts Leaderboard */}
                {posts.length >= 3 && <TopBottomPosts posts={posts} />}

                {/* Posts Table */}
                {posts.length > 0 && (
                    <div className="section-card">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 12 }}>
                            <h3 style={{ margin: 0 }}>Recent Posts ({sortedPosts.length}{filteredPosts.length !== posts.length ? ` of ${posts.length}` : ''})</h3>
                            <div style={{ display: 'flex', gap: 6 }}>
                                {(['all', 'reels', 'carousels', 'photos'] as const).map(f => (
                                    <button
                                        key={f}
                                        onClick={() => setIGFilter(f)}
                                        style={{
                                            background: igFilter === f ? 'var(--accent-primary)' : 'transparent',
                                            color: igFilter === f ? 'white' : 'var(--text-muted)',
                                            border: '1px solid var(--border)',
                                            padding: '4px 12px',
                                            borderRadius: 6,
                                            fontSize: 12,
                                            cursor: 'pointer',
                                            textTransform: 'capitalize',
                                        }}
                                    >
                                        {f}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="data-table-wrapper"><table className="data-table">
                            <thead>
                                <tr>
                                    <th>Caption</th>
                                    <th>Type</th>
                                    <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => handleSort('engagementRate')}>ER%{sortIndicator('engagementRate')}</th>
                                    <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => handleSort('reach')}>Reach{sortIndicator('reach')}</th>
                                    <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => handleSort('views')}>Views{sortIndicator('views')}</th>
                                    <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => handleSort('likeCount')}>Likes{sortIndicator('likeCount')}</th>
                                    <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => handleSort('commentsCount')}>Comments{sortIndicator('commentsCount')}</th>
                                    <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => handleSort('shares')}>Shares{sortIndicator('shares')}</th>
                                    <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => handleSort('saved')}>Saves{sortIndicator('saved')}</th>
                                    <th style={{ cursor: 'pointer' }} onClick={() => handleSort('timestamp')}>Date{sortIndicator('timestamp')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedPosts.map(post => (
                                    <tr key={post.id}>
                                        <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            <a href={post.permalink} target="_blank" rel="noopener noreferrer"
                                                style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}>
                                                {post.caption || '(no caption)'}
                                            </a>
                                        </td>
                                        <td>
                                            <span className={`badge ${post.mediaType === 'VIDEO' ? 'success' : post.mediaType === 'CAROUSEL_ALBUM' ? 'info' : 'warning'}`}>
                                                {post.mediaType === 'VIDEO' ? 'Reel' : post.mediaType === 'CAROUSEL_ALBUM' ? 'Carousel' : 'Photo'}
                                            </span>
                                        </td>
                                        <td style={{ textAlign: 'right' }}>
                                            <span style={{
                                                padding: '2px 8px', borderRadius: 6, fontSize: '0.8125rem', fontWeight: 500,
                                                background: post.engagementRate >= 5 ? 'rgba(34,197,94,0.15)' : post.engagementRate >= 2 ? 'rgba(234,179,8,0.15)' : 'rgba(255,255,255,0.05)',
                                                color: post.engagementRate >= 5 ? '#22c55e' : post.engagementRate >= 2 ? '#eab308' : 'var(--text-muted)',
                                            }}>
                                                {post.engagementRate.toFixed(1)}%
                                            </span>
                                        </td>
                                        <td style={{ textAlign: 'right' }}>{formatNumber(post.reach)}</td>
                                        <td style={{ textAlign: 'right' }}>{formatNumber(post.views)}</td>
                                        <td style={{ textAlign: 'right' }}>{formatNumber(post.likeCount)}</td>
                                        <td style={{ textAlign: 'right' }}>
                                            {formatNumber(post.commentsCount)}
                                            {post.unrepliedCount && post.unrepliedCount > 0 ? (
                                                <span title={`${post.unrepliedCount} unreplied comment${post.unrepliedCount > 1 ? 's' : ''}`} style={{
                                                    marginLeft: 6, padding: '1px 6px', borderRadius: 999,
                                                    background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444',
                                                    fontSize: 10, fontWeight: 600,
                                                }}>
                                                    {post.unrepliedCount} unreplied
                                                </span>
                                            ) : null}
                                        </td>
                                        <td style={{ textAlign: 'right' }}>{formatNumber(post.shares)}</td>
                                        <td style={{ textAlign: 'right' }}>{formatNumber(post.saved)}</td>
                                        <td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                            {new Date(post.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table></div>
                    </div>
                )}
            </>
        );
    };

    // --- Facebook Tab ---
    const renderFacebook = () => {
        if (fbData?.error) return renderError('Facebook', fbData.error);
        if (!fbConfigured) return renderNotConnected('Facebook');
        const s = fbData!.summary!;
        const insights = fbData!.dailyInsights || [];
        const fbDays = fbData!.days || (period === '7d' ? 7 : period === '90d' ? 90 : 30);

        return (
            <>
                {/* FB Coach Panel */}
                <CoachingPanel
                    platformLabel="Facebook"
                    plan={generateFBCoachingPlan({
                        totalVideoViews: s.totalVideoViews,
                        totalEngagements: s.totalEngagements,
                        totalPageViews: s.totalPageViews,
                        engagementRate: s.engagementRate,
                        followerChange: s.followerChange,
                        followerChangePercent: s.followerChangePercent,
                        days: fbDays,
                    })}
                    aiPlan={fbData!.aiCoachingPlan}
                />

                {/* KPI Cards */}
                <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
                    <div className="metric-card">
                        <div className="label">Page Followers</div>
                        <div className="value">{formatNumber(s.followers)}</div>
                        <div className={`change ${s.followerChange >= 0 ? 'positive' : 'negative'}`}>
                            {s.followerChange >= 0 ? '+' : ''}{formatNumber(s.followerChange)} ({s.followerChangePercent}%)
                        </div>
                    </div>
                    <div className="metric-card">
                        <div className="label">Video Views</div>
                        <div className="value">{formatNumber(s.totalVideoViews)}</div>
                        <div className="change">Total video views</div>
                    </div>
                    <div className="metric-card">
                        <div className="label">Engagements</div>
                        <div className="value">{formatNumber(s.totalEngagements)}</div>
                        <div className="change">Post interactions</div>
                    </div>
                    <div className="metric-card">
                        <div className="label">Page Views</div>
                        <div className="value">{formatNumber(s.totalPageViews)}</div>
                        <div className="change">Profile visits</div>
                    </div>
                    <div className="metric-card">
                        <div className="label">Engagement Rate</div>
                        <div className="value">{s.engagementRate}%</div>
                        <div className="change">Engagements / Views</div>
                    </div>
                </div>

                {/* Daily Charts */}
                {insights.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                        <div className="chart-container">
                            <div className="chart-header">
                                <h3>Video Views & Page Views</h3>
                            </div>
                            <ResponsiveContainer width="100%" height={280}>
                                <LineChart data={insights} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                    <XAxis dataKey="date" tick={{ fill: '#A1A1AA', fontSize: 11 }} tickFormatter={formatDate} />
                                    <YAxis tick={{ fill: '#A1A1AA', fontSize: 11 }} tickFormatter={(v) => formatNumber(v)} />
                                    <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(label) => formatDate(String(label))} />
                                    <Legend wrapperStyle={{ color: '#E4E4E7', fontSize: '0.8125rem' }} />
                                    <Line type="monotone" dataKey="pageVideoViews" name="Video Views" stroke="#1877F2" strokeWidth={2} dot={false} />
                                    <Line type="monotone" dataKey="pageViewsTotal" name="Page Views" stroke="#60A5FA" strokeWidth={2} dot={false} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>

                        <div className="chart-container">
                            <div className="chart-header">
                                <h3>Daily Engagement</h3>
                            </div>
                            <ResponsiveContainer width="100%" height={280}>
                                <BarChart data={insights} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                    <XAxis dataKey="date" tick={{ fill: '#A1A1AA', fontSize: 11 }} tickFormatter={formatDate} />
                                    <YAxis tick={{ fill: '#A1A1AA', fontSize: 11 }} />
                                    <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(label) => formatDate(String(label))} />
                                    <Legend wrapperStyle={{ color: '#E4E4E7', fontSize: '0.8125rem' }} />
                                    <Bar dataKey="pagePostEngagements" name="Post Engagements" fill="#1877F2" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                )}
            </>
        );
    };



    // --- Render ---
    return (
        <>
            <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
                <div>
                    <h1>Organic Performance</h1>
                    <p className="subtitle">Track your social media growth and engagement across all platforms</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {lastFetched && (
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                            Updated {lastFetched.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                    )}
                    <button
                        onClick={() => fetchData(true)}
                        disabled={loading}
                        style={{
                            padding: '6px 12px',
                            fontSize: '13px',
                            background: 'transparent',
                            border: '1px solid var(--border)',
                            borderRadius: '8px',
                            color: 'var(--text-muted)',
                            cursor: loading ? 'not-allowed' : 'pointer',
                            opacity: loading ? 0.5 : 1,
                        }}
                    >
                        {loading ? 'Loading…' : '↻ Refresh'}
                    </button>
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
            </div>

            <MetaTokenBanner />

            <div className="sub-tabs">
                {PLATFORMS.map(platform => (
                    <button
                        key={platform}
                        className={`sub-tab ${activeTab === platform ? 'active' : ''}`}
                        onClick={() => setActiveTab(platform)}
                    >
                        {platform}
                    </button>
                ))}
            </div>

            {loading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                    <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                        <SkeletonKpiCard />
                        <SkeletonKpiCard />
                        <SkeletonKpiCard />
                        <SkeletonKpiCard />
                    </div>
                    {activeTab === 'All Platforms' ? (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
                            <SkeletonChart height={160} />
                            <SkeletonChart height={160} />
                            <SkeletonChart height={160} />
                        </div>
                    ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                            <SkeletonChart height={300} />
                            <SkeletonChart height={300} />
                        </div>
                    )}
                </div>
            ) : (
                <>
                    {activeTab === 'All Platforms' && renderAllPlatforms()}
                    {activeTab === 'Instagram' && renderInstagram()}
                    {activeTab === 'Inbox' && (
                        !igConfigured && !fbConfigured ? renderNotConnected('Instagram / Facebook')
                        : <InboxTab
                            unrepliedInbox={igConfigured ? (igData?.unrepliedInbox || []) : []}
                            fbUnrepliedInbox={fbConfigured ? (fbData?.unrepliedInbox || []) : []}
                          />
                    )}
                    {activeTab === 'Facebook' && renderFacebook()}
                    {activeTab === 'YouTube' && (
                        <YouTubeTab ytData={ytData} ytConfigured={!!ytConfigured} period={period} renderError={renderError} renderNotConnected={renderNotConnected} />
                    )}
                    {activeTab === 'Repurposing' && (
                        <RepurposingTab data={repurposingData} loading={repurposingLoading} />
                    )}
                </>
            )}
        </>
    );
}
