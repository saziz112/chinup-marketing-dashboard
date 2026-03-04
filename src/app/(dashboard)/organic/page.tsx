'use client';

import { useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { useState, useEffect, useCallback } from 'react';
import { SkeletonKpiCard, SkeletonChart } from '@/components/Skeleton';
import {
    LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

type Period = '7d' | '30d' | '90d';
type PlatformTab = 'All Platforms' | 'Instagram' | 'Facebook' | 'YouTube';

interface IGData {
    configured: boolean;
    error?: string;
    profile?: {
        username: string;
        name: string;
        followersCount: number;
        mediaCount: number;
        profilePictureUrl: string;
    };
    summary?: {
        followers: number;
        followerChange: number;
        followerChangePercent: number;
        totalReach: number;
        totalViews: number;
        totalInteractions: number;
        totalEngaged: number;
        profileViews: number;
        likes: number;
        comments: number;
        shares: number;
        saves: number;
        engagementRate: number;
    };
    dailyInsights?: Array<{
        date: string;
        reach: number;
        followerCount: number;
    }>;
    posts?: Array<{
        id: string;
        caption: string;
        mediaType: string;
        permalink: string;
        timestamp: string;
        likeCount: number;
        commentsCount: number;
        views: number;
        reach: number;
        shares: number;
        saved: number;
        totalInteractions: number;
        plays?: number;
    }>;
    topPost?: {
        id: string;
        caption: string;
        mediaType: string;
        permalink: string;
        totalInteractions: number;
    } | null;
}

interface YTData {
    configured: boolean;
    error?: string;
    channel?: {
        title: string;
        customUrl: string;
        thumbnailUrl: string;
        subscriberCount: number;
        viewCount: number;
        videoCount: number;
    };
    summary?: {
        subscribers: number;
        totalViews: number;
        totalVideos: number;
        recentVideoViews: number;
        recentVideoLikes: number;
        recentVideoComments: number;
        engagementRate: number;
        avgViewsPerVideo: number;
        shortsCount: number;
        longFormCount: number;
    };
    videos?: Array<{
        id: string;
        title: string;
        publishedAt: string;
        thumbnailUrl: string;
        durationSeconds: number;
        viewCount: number;
        likeCount: number;
        commentCount: number;
        isShort: boolean;
    }>;
    videosInPeriod?: number;
}

interface FBData {
    configured: boolean;
    error?: string;
    page?: {
        name: string;
        followersCount: number;
        fanCount: number;
        link: string;
        picture: string;
    };
    summary?: {
        followers: number;
        followerChange: number;
        followerChangePercent: number;
        totalVideoViews: number;
        totalEngagements: number;
        totalPageViews: number;
        engagementRate: number;
    };
    dailyInsights?: Array<{
        date: string;
        pageFollows: number;
        pageViewsTotal: number;
        pagePostEngagements: number;
        pageVideoViews: number;
    }>;
}

const PLATFORMS: PlatformTab[] = ['All Platforms', 'Instagram', 'Facebook', 'YouTube'];

const TOOLTIP_STYLE = {
    background: '#0A225C',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: '#FEFEFE',
};

function formatNumber(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toLocaleString();
}

function formatDate(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function OrganicPage() {
    const { data: session } = useSession();
    const searchParams = useSearchParams();

    // Read ?tab= query param from URL (e.g., from Overview platform cards)
    const getInitialTab = (): PlatformTab => {
        const tab = searchParams.get('tab');
        const map: Record<string, PlatformTab> = {
            instagram: 'Instagram',
            facebook: 'Facebook',
            youtube: 'YouTube',
        };
        return map[tab || ''] || 'All Platforms';
    };

    const [activeTab, setActiveTab] = useState<PlatformTab>(getInitialTab);
    const [period, setPeriod] = useState<Period>('30d');
    const [loading, setLoading] = useState(true);

    const [igData, setIGData] = useState<IGData | null>(null);
    const [fbData, setFBData] = useState<FBData | null>(null);
    const [ytData, setYTData] = useState<YTData | null>(null);

    const fetchData = useCallback(async () => {
        setLoading(true);

        const [igRes, fbRes, ytRes] = await Promise.allSettled([
            fetch(`/api/organic/instagram?period=${period}`).then(r => r.json()),
            fetch(`/api/organic/facebook?period=${period}`).then(r => r.json()),
            fetch(`/api/organic/youtube?period=${period}`).then(r => r.json()),
        ]);

        setIGData(igRes.status === 'fulfilled' ? igRes.value : null);
        setFBData(fbRes.status === 'fulfilled' ? fbRes.value : null);
        setYTData(ytRes.status === 'fulfilled' ? ytRes.value : null);
        setLoading(false);
    }, [period]);

    useEffect(() => {
        if (session) fetchData();
    }, [session, fetchData]);

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

        return (
            <>
                {/* KPI Cards */}
                <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                    <div className="metric-card">
                        <div className="label">Total Followers</div>
                        <div className="value">
                            {formatNumber(
                                (igData?.summary?.followers || 0) + (fbData?.summary?.followers || 0) + (ytData?.summary?.subscribers || 0)
                            )}
                        </div>
                        <div className="change">Across connected platforms</div>
                    </div>
                    <div className="metric-card">
                        <div className="label">Total Reach</div>
                        <div className="value">
                            {formatNumber(
                                (igData?.summary?.totalReach || 0) + (fbData?.summary?.totalVideoViews || 0) + (ytData?.summary?.recentVideoViews || 0)
                            )}
                        </div>
                        <div className="change">IG reach + FB/YT views</div>
                    </div>
                    <div className="metric-card">
                        <div className="label">Total Engagement</div>
                        <div className="value">
                            {formatNumber(
                                (igData?.summary?.totalInteractions || 0) + (fbData?.summary?.totalEngagements || 0) + (ytData?.summary?.recentVideoLikes || 0) + (ytData?.summary?.recentVideoComments || 0)
                            )}
                        </div>
                        <div className="change">Interactions + engagements</div>
                    </div>
                    <div className="metric-card">
                        <div className="label">Avg Engagement Rate</div>
                        <div className="value">
                            {(() => {
                                const rates = [
                                    igConfigured ? igData?.summary?.engagementRate : null,
                                    fbConfigured ? fbData?.summary?.engagementRate : null,
                                    ytConfigured ? ytData?.summary?.engagementRate : null,
                                ].filter((r): r is number => r !== null && r !== undefined);
                                return rates.length > 0
                                    ? `${(rates.reduce((a, b) => a + b, 0) / rates.length).toFixed(2)}%`
                                    : '--%';
                            })()}
                        </div>
                        <div className="change">Weighted average</div>
                    </div>
                </div>

                {/* Platform Summary Cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
                    {igConfigured && igData?.summary && (
                        <div className={`section-card ${activeTab === 'Instagram' ? 'active-tab-card' : ''}`} style={{ cursor: 'pointer', borderColor: activeTab === 'Instagram' ? 'var(--accent-primary)' : 'var(--border)' }} onClick={() => setActiveTab('Instagram')}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                                <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(225, 48, 108, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: '1rem', color: '#E1306C' }}>I</div>
                                <div>
                                    <div style={{ fontWeight: 600 }}>Instagram</div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>@{igData.profile?.username}</div>
                                </div>
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
                    )}

                    {fbConfigured && fbData?.summary && (
                        <div className={`section-card ${activeTab === 'Facebook' ? 'active-tab-card' : ''}`} style={{ cursor: 'pointer', borderColor: activeTab === 'Facebook' ? 'var(--accent-primary)' : 'var(--border)' }} onClick={() => setActiveTab('Facebook')}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                                <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(24, 119, 242, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: '1rem', color: '#1877F2' }}>F</div>
                                <div>
                                    <div style={{ fontWeight: 600 }}>Facebook</div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{fbData.page?.name}</div>
                                </div>
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
                    )}

                    {ytConfigured && ytData?.summary && (
                        <div className={`section-card ${activeTab === 'YouTube' ? 'active-tab-card' : ''}`} style={{ cursor: 'pointer', borderColor: activeTab === 'YouTube' ? 'var(--accent-primary)' : 'var(--border)' }} onClick={() => setActiveTab('YouTube')}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                                <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(255, 0, 0, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: '1rem', color: '#FF0000' }}>Y</div>
                                <div>
                                    <div style={{ fontWeight: 600 }}>YouTube</div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{ytData.channel?.title}</div>
                                </div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                                <div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Subscribers</div>
                                    <div style={{ fontWeight: 700, fontSize: '1.125rem' }}>{formatNumber(ytData.summary.subscribers)}</div>
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
                    )}

                </div>

                {/* Combined Trend Charts */}
                {combinedDaily.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                        <div className="chart-container">
                            <div className="chart-header">
                                <h3>Reach & Views</h3>
                                <span className="badge info">{period}</span>
                            </div>
                            <ResponsiveContainer width="100%" height={280}>
                                <LineChart data={combinedDaily} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                    <XAxis dataKey="date" tick={{ fill: '#A1A1AA', fontSize: 11 }} tickFormatter={formatDate} />
                                    <YAxis tick={{ fill: '#A1A1AA', fontSize: 11 }} tickFormatter={(v) => formatNumber(v)} />
                                    <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(label) => formatDate(String(label))} />
                                    <Legend wrapperStyle={{ color: '#E4E4E7', fontSize: '0.8125rem' }} />
                                    {igConfigured && <Line type="monotone" dataKey="igReach" name="IG Reach" stroke="#E1306C" strokeWidth={2} dot={false} />}
                                    {fbConfigured && <Line type="monotone" dataKey="fbVideoViews" name="FB Video Views" stroke="#1877F2" strokeWidth={2} dot={false} />}
                                </LineChart>
                            </ResponsiveContainer>
                        </div>

                        <div className="chart-container">
                            <div className="chart-header">
                                <h3>Engagement</h3>
                                <span className="badge info">{period}</span>
                            </div>
                            <ResponsiveContainer width="100%" height={280}>
                                <BarChart data={combinedDaily} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                    <XAxis dataKey="date" tick={{ fill: '#A1A1AA', fontSize: 11 }} tickFormatter={formatDate} />
                                    <YAxis tick={{ fill: '#A1A1AA', fontSize: 11 }} tickFormatter={(v) => formatNumber(v)} />
                                    <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(label) => formatDate(String(label))} />
                                    <Legend wrapperStyle={{ color: '#E4E4E7', fontSize: '0.8125rem' }} />
                                    {fbConfigured && <Bar dataKey="fbEngagements" name="FB Engagements" fill="#1877F2" radius={[4, 4, 0, 0]} />}
                                </BarChart>
                            </ResponsiveContainer>
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
        const insights = igData!.dailyInsights || [];
        const posts = igData!.posts || [];

        return (
            <>
                {/* KPI Cards */}
                <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
                    <div className="metric-card">
                        <div className="label">Followers</div>
                        <div className="value">{formatNumber(s.followers)}</div>
                        <div className={`change ${s.followerChange >= 0 ? 'positive' : 'negative'}`}>
                            {s.followerChange >= 0 ? '+' : ''}{formatNumber(s.followerChange)} ({s.followerChangePercent}%)
                        </div>
                    </div>
                    <div className="metric-card">
                        <div className="label">Reach</div>
                        <div className="value">{formatNumber(s.totalReach)}</div>
                        <div className="change">Unique accounts</div>
                    </div>
                    <div className="metric-card">
                        <div className="label">Views</div>
                        <div className="value">{formatNumber(s.totalViews)}</div>
                        <div className="change">Total content views</div>
                    </div>
                    <div className="metric-card">
                        <div className="label">Interactions</div>
                        <div className="value">{formatNumber(s.totalInteractions)}</div>
                        <div className="change">Likes, comments, shares, saves</div>
                    </div>
                    <div className="metric-card">
                        <div className="label">Engagement Rate</div>
                        <div className="value">{s.engagementRate}%</div>
                        <div className="change">Interactions / Reach</div>
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

                {/* Top Posts Table */}
                {posts.length > 0 && (
                    <div className="section-card">
                        <h3>Recent Posts ({posts.length})</h3>
                        <div className="data-table-wrapper"><table className="data-table">
                            <thead>
                                <tr>
                                    <th>Caption</th>
                                    <th>Type</th>
                                    <th style={{ textAlign: 'right' }}>Likes</th>
                                    <th style={{ textAlign: 'right' }}>Comments</th>
                                    <th style={{ textAlign: 'right' }}>Shares</th>
                                    <th style={{ textAlign: 'right' }}>Saves</th>
                                    <th style={{ textAlign: 'right' }}>Reach</th>
                                    <th style={{ textAlign: 'right' }}>Views</th>
                                    <th>Date</th>
                                </tr>
                            </thead>
                            <tbody>
                                {posts.map(post => (
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
                                        <td style={{ textAlign: 'right' }}>{formatNumber(post.likeCount)}</td>
                                        <td style={{ textAlign: 'right' }}>{formatNumber(post.commentsCount)}</td>
                                        <td style={{ textAlign: 'right' }}>{formatNumber(post.shares)}</td>
                                        <td style={{ textAlign: 'right' }}>{formatNumber(post.saved)}</td>
                                        <td style={{ textAlign: 'right' }}>{formatNumber(post.reach)}</td>
                                        <td style={{ textAlign: 'right' }}>{formatNumber(post.views)}</td>
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

        return (
            <>
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

    // --- YouTube Tab ---
    const renderYouTube = () => {
        if (ytData?.error) return renderError('YouTube', ytData.error);
        if (!ytConfigured) {
            return (
                <div className="section-card">
                    <div className="empty-state">
                        <h3>YouTube not connected</h3>
                        <p>Add your YouTube API credentials to .env.local to see YouTube data.</p>
                        <p style={{ marginTop: 8, color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
                            Required: YOUTUBE_API_KEY, YOUTUBE_CHANNEL_ID
                        </p>
                    </div>
                </div>
            );
        }
        const s = ytData!.summary!;
        const videos = ytData!.videos || [];

        const formatDuration = (sec: number) => {
            if (sec < 60) return `${sec}s`;
            const m = Math.floor(sec / 60);
            const sRem = sec % 60;
            if (m < 60) return `${m}:${sRem.toString().padStart(2, '0')}`;
            const h = Math.floor(m / 60);
            return `${h}:${(m % 60).toString().padStart(2, '0')}:${sRem.toString().padStart(2, '0')}`;
        };

        // Build per-video bar chart data (top 15 by views)
        const chartVideos = [...videos]
            .sort((a, b) => b.viewCount - a.viewCount)
            .slice(0, 15)
            .map(v => ({
                title: v.title.substring(0, 30) + (v.title.length > 30 ? '...' : ''),
                views: v.viewCount,
                likes: v.likeCount,
                comments: v.commentCount,
            }));

        return (
            <>
                {/* KPI Cards */}
                <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
                    <div className="metric-card">
                        <div className="label">Subscribers</div>
                        <div className="value">{formatNumber(s.subscribers)}</div>
                        <div className="change">{formatNumber(s.totalVideos)} total videos</div>
                    </div>
                    <div className="metric-card">
                        <div className="label">Views ({period})</div>
                        <div className="value">{formatNumber(s.recentVideoViews)}</div>
                        <div className="change">{ytData?.videosInPeriod || 0} videos in period</div>
                    </div>
                    <div className="metric-card">
                        <div className="label">Likes ({period})</div>
                        <div className="value">{formatNumber(s.recentVideoLikes)}</div>
                        <div className="change">From recent uploads</div>
                    </div>
                    <div className="metric-card">
                        <div className="label">Avg Views/Video</div>
                        <div className="value">{formatNumber(s.avgViewsPerVideo)}</div>
                        <div className="change">{s.shortsCount} shorts, {s.longFormCount} long-form</div>
                    </div>
                    <div className="metric-card">
                        <div className="label">Engagement Rate</div>
                        <div className="value">{s.engagementRate}%</div>
                        <div className="change">(Likes + Comments) / Views</div>
                    </div>
                </div>

                {/* Video Performance Chart */}
                {chartVideos.length > 0 && (
                    <div className="chart-container">
                        <div className="chart-header">
                            <h3>Top Videos by Views</h3>
                            <span className="badge info">{period}</span>
                        </div>
                        <ResponsiveContainer width="100%" height={320}>
                            <BarChart data={chartVideos} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                <XAxis type="number" tick={{ fill: '#A1A1AA', fontSize: 11 }} tickFormatter={(v) => formatNumber(v)} />
                                <YAxis type="category" dataKey="title" tick={{ fill: '#A1A1AA', fontSize: 10 }} width={180} />
                                <Tooltip contentStyle={TOOLTIP_STYLE} />
                                <Legend wrapperStyle={{ color: '#E4E4E7', fontSize: '0.8125rem' }} />
                                <Bar dataKey="views" name="Views" fill="#FF0000" radius={[0, 4, 4, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                )}

                {/* Videos Table */}
                {videos.length > 0 && (
                    <div className="section-card">
                        <h3>Recent Videos ({videos.length})</h3>
                        <div className="data-table-wrapper"><table className="data-table">
                            <thead>
                                <tr>
                                    <th>Title</th>
                                    <th>Type</th>
                                    <th style={{ textAlign: 'right' }}>Views</th>
                                    <th style={{ textAlign: 'right' }}>Likes</th>
                                    <th style={{ textAlign: 'right' }}>Comments</th>
                                    <th>Duration</th>
                                    <th>Date</th>
                                </tr>
                            </thead>
                            <tbody>
                                {videos.map(video => (
                                    <tr key={video.id}>
                                        <td style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            <a href={`https://youtube.com/watch?v=${video.id}`} target="_blank" rel="noopener noreferrer"
                                                style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}>
                                                {video.title || '(untitled)'}
                                            </a>
                                        </td>
                                        <td>
                                            <span className={`badge ${video.isShort ? 'warning' : 'info'}`}>
                                                {video.isShort ? 'Short' : 'Video'}
                                            </span>
                                        </td>
                                        <td style={{ textAlign: 'right' }}>{formatNumber(video.viewCount)}</td>
                                        <td style={{ textAlign: 'right' }}>{formatNumber(video.likeCount)}</td>
                                        <td style={{ textAlign: 'right' }}>{formatNumber(video.commentCount)}</td>
                                        <td style={{ color: 'var(--text-muted)' }}>{formatDuration(video.durationSeconds)}</td>
                                        <td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                            {new Date(video.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
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


    // --- Render ---
    return (
        <>
            <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
                <div>
                    <h1>Organic Performance</h1>
                    <p className="subtitle">Track your social media growth and engagement across all platforms</p>
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
                    {activeTab === 'Facebook' && renderFacebook()}
                    {activeTab === 'YouTube' && renderYouTube()}
                </>
            )}
        </>
    );
}
