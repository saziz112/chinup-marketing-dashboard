'use client';

import React from 'react';
import {
    BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { format, parseISO, getHours } from 'date-fns';
import { formatNumber, formatDate } from '@/lib/format';
import { TOOLTIP_STYLE, PLATFORM_COLORS } from '@/lib/constants';
import { SkeletonKpiCard, SkeletonChart } from '@/components/Skeleton';

/* ── Shared Types ────────────────────────────────────────────────── */

export type Period = '7d' | '30d' | '90d';
export type PlatformTab = 'All Platforms' | 'Instagram' | 'Facebook' | 'YouTube' | 'TikTok' | 'Content';

export interface IGData {
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

export interface YTData {
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

export interface ContentPost {
    id: string;
    platform: 'instagram' | 'youtube';
    title: string;
    description: string;
    publishedAt: string;
    thumbnailUrl: string;
    url: string;
    views: number;
    likes: number;
    comments: number;
    shares: number;
    engagementRate: number;
    mediaType?: string;
}

export interface FBData {
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

/* ── YouTube Tab ─────────────────────────────────────────────────── */

interface YouTubeTabProps {
    ytData: YTData | null;
    ytConfigured: boolean;
    period: Period;
    renderError: (platform: string, errorMsg: string) => React.ReactNode;
    renderNotConnected: (platform: string) => React.ReactNode;
}

function formatDuration(sec: number) {
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const sRem = sec % 60;
    if (m < 60) return `${m}:${sRem.toString().padStart(2, '0')}`;
    const h = Math.floor(m / 60);
    return `${h}:${(m % 60).toString().padStart(2, '0')}:${sRem.toString().padStart(2, '0')}`;
}

export function YouTubeTab({ ytData, ytConfigured, period, renderError, renderNotConnected }: YouTubeTabProps) {
    if (ytData?.error) return <>{renderError('YouTube', ytData.error)}</>;
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
}

/* ── TikTok Tab ──────────────────────────────────────────────────── */

interface TikTokTabProps {
    ttData: any | null;
    ttConfigured: boolean;
    renderError: (platform: string, errorMsg: string) => React.ReactNode;
}

export function TikTokTab({ ttData, ttConfigured, renderError }: TikTokTabProps) {
    if (ttData?.error) return <>{renderError('TikTok', ttData.error)}</>;
    if (!ttConfigured) {
        return (
            <div className="section-card">
                <div className="empty-state">
                    <h3>TikTok not connected</h3>
                    <p>Add APIFY_API_TOKEN and TIKTOK_USERNAME to environment variables.</p>
                </div>
            </div>
        );
    }
    const s = ttData!.summary!;
    const videos = ttData!.videos || [];

    return (
        <>
            {/* KPI Cards */}
            <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
                <div className="metric-card">
                    <div className="label">Followers</div>
                    <div className="value">{formatNumber(s.followers)}</div>
                    <div className="change">{formatNumber(s.totalLikes)} total likes</div>
                </div>
                <div className="metric-card">
                    <div className="label">Avg Views</div>
                    <div className="value">{formatNumber(s.avgViews)}</div>
                    <div className="change">{videos.length} videos in period</div>
                </div>
                <div className="metric-card">
                    <div className="label">Engagement Rate</div>
                    <div className="value">{(s.engagementRate * 100).toFixed(1)}%</div>
                    <div className="change">(Likes+Comments+Shares)/Views</div>
                </div>
                <div className="metric-card">
                    <div className="label">Saves Rate</div>
                    <div className="value">{(s.savesRate * 100).toFixed(2)}%</div>
                    <div className="change">Bookmarks / Views</div>
                </div>
                <div className="metric-card">
                    <div className="label">Post Cadence</div>
                    <div className="value">{s.postingCadence}/wk</div>
                    <div className="change">{formatNumber(s.videoCount)} total videos</div>
                </div>
            </div>

            {/* Breakout Videos */}
            {s.breakoutVideos?.length > 0 && (
                <div className="section-card" style={{ borderColor: 'rgba(254, 44, 85, 0.3)', backgroundColor: 'rgba(254, 44, 85, 0.03)' }}>
                    <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        Breakout Videos
                        <span style={{ fontSize: '0.7rem', background: 'rgba(254, 44, 85, 0.15)', color: '#FE2C55', padding: '2px 8px', borderRadius: '10px' }}>
                            {s.breakoutVideos.length} hit{s.breakoutVideos.length > 1 ? 's' : ''}
                        </span>
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {s.breakoutVideos.map((v: any, i: number) => (
                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: '8px' }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {v.description || 'Untitled'}
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.75rem', marginTop: '4px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                        <span>{formatNumber(v.views)} views</span>
                                        <span>{formatNumber(v.likes)} likes</span>
                                        <span>{formatNumber(v.comments)} comments</span>
                                        {v.musicTitle && <span>Sound: {v.musicTitle}</span>}
                                    </div>
                                </div>
                                <div style={{ textAlign: 'right', marginLeft: '1rem', flexShrink: 0 }}>
                                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#FE2C55' }}>{v.viewMultiplier}x</div>
                                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>vs avg</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Top Sounds + Top Hashtags side by side */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                {s.topSounds?.length > 0 && (
                    <div className="section-card">
                        <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem' }}>Top Sounds</h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {s.topSounds.map((sound: any, i: number) => (
                                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0', borderBottom: i < s.topSounds.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                                    <div>
                                        <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>{sound.title}</div>
                                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{sound.author} ({sound.count}x used)</div>
                                    </div>
                                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>{formatNumber(sound.avgViews)} avg views</div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {s.topHashtags?.length > 0 && (
                    <div className="section-card">
                        <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem' }}>Top Hashtags</h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {s.topHashtags.map((ht: any, i: number) => (
                                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0', borderBottom: i < s.topHashtags.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                                    <div style={{ fontSize: '0.85rem', color: '#25F4EE' }}>{ht.tag} <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>({ht.count}x)</span></div>
                                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>{formatNumber(ht.avgViews)} avg views</div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Recent Videos Table */}
            {videos.length > 0 && (
                <div className="section-card">
                    <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem' }}>Recent Videos</h3>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                    <th style={{ textAlign: 'left', padding: '0.5rem', color: 'var(--text-muted)', fontWeight: 500 }}>Description</th>
                                    <th style={{ textAlign: 'right', padding: '0.5rem', color: 'var(--text-muted)', fontWeight: 500 }}>Views</th>
                                    <th style={{ textAlign: 'right', padding: '0.5rem', color: 'var(--text-muted)', fontWeight: 500 }}>Likes</th>
                                    <th style={{ textAlign: 'right', padding: '0.5rem', color: 'var(--text-muted)', fontWeight: 500 }}>Comments</th>
                                    <th style={{ textAlign: 'right', padding: '0.5rem', color: 'var(--text-muted)', fontWeight: 500 }}>Shares</th>
                                    <th style={{ textAlign: 'right', padding: '0.5rem', color: 'var(--text-muted)', fontWeight: 500 }}>Saves</th>
                                    <th style={{ textAlign: 'left', padding: '0.5rem', color: 'var(--text-muted)', fontWeight: 500 }}>Sound</th>
                                    <th style={{ textAlign: 'left', padding: '0.5rem', color: 'var(--text-muted)', fontWeight: 500 }}>Date</th>
                                </tr>
                            </thead>
                            <tbody>
                                {videos.slice(0, 20).map((v: any, i: number) => (
                                    <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                                        <td style={{ padding: '0.5rem', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            <a href={v.videoUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-primary)', textDecoration: 'none' }}>
                                                {v.description?.substring(0, 50) || 'Untitled'}{v.description?.length > 50 ? '...' : ''}
                                            </a>
                                        </td>
                                        <td style={{ textAlign: 'right', padding: '0.5rem', fontWeight: 600 }}>{formatNumber(v.views)}</td>
                                        <td style={{ textAlign: 'right', padding: '0.5rem' }}>{formatNumber(v.likes)}</td>
                                        <td style={{ textAlign: 'right', padding: '0.5rem' }}>{formatNumber(v.comments)}</td>
                                        <td style={{ textAlign: 'right', padding: '0.5rem' }}>{formatNumber(v.shares)}</td>
                                        <td style={{ textAlign: 'right', padding: '0.5rem' }}>{formatNumber(v.saves)}</td>
                                        <td style={{ padding: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {v.musicTitle || '\u2014'}
                                        </td>
                                        <td style={{ padding: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                            {v.createTime ? new Date(v.createTime * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '\u2014'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Scraped timestamp */}
            {ttData?.scrapedAt && (
                <div style={{ textAlign: 'right', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                    Data scraped: {new Date(ttData.scrapedAt).toLocaleString()}
                </div>
            )}
        </>
    );
}

/* ── Content Tab ─────────────────────────────────────────────────── */

interface ContentTabProps {
    contentPosts: ContentPost[];
    contentLoading: boolean;
    contentPlatformFilter: 'all' | 'instagram' | 'youtube';
    setContentPlatformFilter: (f: 'all' | 'instagram' | 'youtube') => void;
    contentSortKey: keyof ContentPost;
    setContentSortKey: (k: keyof ContentPost) => void;
    contentSortOrder: 'asc' | 'desc';
    setContentSortOrder: (o: 'asc' | 'desc') => void;
}

export function ContentTab({
    contentPosts,
    contentLoading,
    contentPlatformFilter,
    setContentPlatformFilter,
    contentSortKey,
    setContentSortKey,
    contentSortOrder,
    setContentSortOrder,
}: ContentTabProps) {
    if (contentLoading) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                    <SkeletonKpiCard />
                    <SkeletonKpiCard />
                    <SkeletonKpiCard />
                </div>
                <SkeletonChart height={300} />
            </div>
        );
    }

    // Filter & sort
    let filtered = [...contentPosts];
    if (contentPlatformFilter !== 'all') {
        filtered = filtered.filter(p => p.platform === contentPlatformFilter);
    }

    const sorted = [...filtered].sort((a, b) => {
        const aVal = a[contentSortKey];
        const bVal = b[contentSortKey];
        if (contentSortKey === 'publishedAt') {
            const aTime = new Date(aVal as string).getTime();
            const bTime = new Date(bVal as string).getTime();
            return contentSortOrder === 'asc' ? aTime - bTime : bTime - aTime;
        }
        if (typeof aVal === 'number' && typeof bVal === 'number') {
            return contentSortOrder === 'asc' ? aVal - bVal : bVal - aVal;
        }
        return 0;
    });

    // Top 3 posts by views
    const topPosts = [...filtered].sort((a, b) => b.views - a.views).slice(0, 3);

    // KPI calcs
    let totalEng = 0, totalViews = 0;
    const platformStats: Record<string, { views: number; count: number }> = { instagram: { views: 0, count: 0 }, youtube: { views: 0, count: 0 } };
    filtered.forEach(p => {
        totalEng += p.likes + p.comments + p.shares;
        totalViews += p.views;
        if (platformStats[p.platform]) { platformStats[p.platform].views += p.views; platformStats[p.platform].count += 1; }
    });
    const avgEngRate = totalViews > 0 ? (totalEng / totalViews) * 100 : 0;
    let topPlatform = 'None';
    let highestAvg = 0;
    Object.entries(platformStats).forEach(([key, stat]) => {
        if (stat.count > 0 && stat.views / stat.count > highestAvg) { highestAvg = stat.views / stat.count; topPlatform = key; }
    });

    // Best time to post data
    const hourBuckets: Record<number, { engRateSum: number; count: number }> = {};
    filtered.forEach(p => {
        const h = getHours(parseISO(p.publishedAt));
        if (!hourBuckets[h]) hourBuckets[h] = { engRateSum: 0, count: 0 };
        hourBuckets[h].engRateSum += p.engagementRate;
        hourBuckets[h].count += 1;
    });
    const bestTimeData = Array.from({ length: 24 }).map((_, i) => {
        const bucket = hourBuckets[i];
        const avgRate = bucket && bucket.count > 0 ? bucket.engRateSum / bucket.count : 0;
        return { hour: format(new Date().setHours(i), 'ha'), engagementRate: Number(avgRate.toFixed(2)) };
    });

    const handleContentSort = (key: keyof ContentPost) => {
        if (contentSortKey === key) {
            setContentSortOrder(contentSortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setContentSortKey(key);
            setContentSortOrder('desc');
        }
    };

    const getPlatformColor = (p: string) => PLATFORM_COLORS[p] || '#888';

    if (contentPosts.length === 0) {
        return (
            <div className="section-card">
                <div className="empty-state">
                    <h3>No content data</h3>
                    <p>Connect Instagram or YouTube to see cross-platform content performance.</p>
                </div>
            </div>
        );
    }

    return (
        <>
            {/* KPIs */}
            <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                <div className="metric-card">
                    <div className="label">Posts Analyzed</div>
                    <div className="value">{filtered.length}</div>
                    <div className="change">Across connected platforms</div>
                </div>
                <div className="metric-card">
                    <div className="label">Avg Engagement Rate</div>
                    <div className="value">{avgEngRate.toFixed(2)}%</div>
                    <div className="change">(Likes + Comments + Shares) / Views</div>
                </div>
                <div className="metric-card">
                    <div className="label">Top Platform (Avg Views)</div>
                    <div className="value" style={{ textTransform: 'capitalize' }}>{topPlatform}</div>
                    <div className="change">Highest avg views per post</div>
                </div>
            </div>

            {/* Leaderboard + Best Time to Post */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px' }}>
                {/* Top Posts Leaderboard */}
                <div className="section-card">
                    <h3 style={{ marginBottom: '16px' }}>Top Posts Leaderboard</h3>
                    {topPosts.length === 0 ? (
                        <p style={{ color: 'var(--text-muted)' }}>No posts to display.</p>
                    ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
                            {topPosts.map(post => (
                                <div key={post.id} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' }}>
                                    <div style={{ height: '140px', background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                                        {post.thumbnailUrl ? (
                                            <img src={post.thumbnailUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.8 }} />
                                        ) : (
                                            <span style={{ fontSize: '2rem', opacity: 0.3 }}>&#9654;</span>
                                        )}
                                        <div style={{
                                            position: 'absolute', top: 8, left: 8, width: 28, height: 28, borderRadius: '50%',
                                            background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            color: getPlatformColor(post.platform), fontWeight: 700, fontSize: '0.75rem'
                                        }}>
                                            {post.platform === 'instagram' ? 'IG' : 'YT'}
                                        </div>
                                    </div>
                                    <div style={{ padding: '12px' }}>
                                        <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                                            {format(parseISO(post.publishedAt), 'MMM d, yyyy')}
                                        </div>
                                        <div style={{ fontSize: '0.8125rem', fontWeight: 500, marginBottom: '10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={post.title || post.description}>
                                            {post.title || post.description || 'Untitled'}
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                            <span>{formatNumber(post.views)} views</span>
                                            <span>{formatNumber(post.likes)} likes</span>
                                            <a href={post.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}>View</a>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Best Time to Post */}
                <div className="section-card" style={{ display: 'flex', flexDirection: 'column' }}>
                    <h3 style={{ marginBottom: '4px' }}>Best Time to Post</h3>
                    <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '16px' }}>Engagement rate by hour</p>
                    <div style={{ flex: 1, minHeight: '200px' }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={bestTimeData}>
                                <defs>
                                    <linearGradient id="colorEngContent" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="var(--accent-primary)" stopOpacity={0.8} />
                                        <stop offset="95%" stopColor="var(--accent-primary)" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <XAxis dataKey="hour" tick={{ fill: '#A1A1AA', fontSize: 10 }} tickMargin={6} />
                                <YAxis tick={{ fill: '#A1A1AA', fontSize: 10 }} tickFormatter={(v) => `${v}%`} width={35} />
                                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value: any) => [`${value}%`, 'Avg Engagement']} />
                                <Area type="monotone" dataKey="engagementRate" stroke="var(--accent-primary)" fillOpacity={1} fill="url(#colorEngContent)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* Unified Master Table */}
            <div className="section-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <h3 style={{ margin: 0 }}>All Content</h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '2px', background: 'rgba(255,255,255,0.05)', padding: '3px', borderRadius: '8px' }}>
                        {(['all', 'instagram', 'youtube'] as const).map(pf => (
                            <button key={pf} onClick={() => setContentPlatformFilter(pf)} style={{
                                padding: '6px 14px', borderRadius: '6px', border: 'none', cursor: 'pointer',
                                fontSize: '0.8125rem', transition: 'all 0.2s',
                                background: contentPlatformFilter === pf
                                    ? pf === 'instagram' ? 'rgba(225,48,108,0.15)' : pf === 'youtube' ? 'rgba(255,0,0,0.15)' : 'rgba(255,255,255,0.12)'
                                    : 'transparent',
                                color: contentPlatformFilter === pf
                                    ? pf === 'instagram' ? '#E1306C' : pf === 'youtube' ? '#FF0000' : '#fff'
                                    : 'var(--text-muted)',
                                fontWeight: contentPlatformFilter === pf ? 600 : 400,
                            }}>
                                {pf === 'all' ? 'All' : pf === 'instagram' ? 'IG' : 'YT'}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="data-table-wrapper"><table className="data-table">
                    <thead>
                        <tr>
                            <th>Post</th>
                            <th style={{ cursor: 'pointer' }} onClick={() => handleContentSort('platform')}>
                                Platform {contentSortKey === 'platform' && (contentSortOrder === 'asc' ? '\u2191' : '\u2193')}
                            </th>
                            <th style={{ cursor: 'pointer' }} onClick={() => handleContentSort('publishedAt')}>
                                Date {contentSortKey === 'publishedAt' && (contentSortOrder === 'asc' ? '\u2191' : '\u2193')}
                            </th>
                            <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => handleContentSort('views')}>
                                Views {contentSortKey === 'views' && (contentSortOrder === 'asc' ? '\u2191' : '\u2193')}
                            </th>
                            <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => handleContentSort('likes')}>
                                Likes {contentSortKey === 'likes' && (contentSortOrder === 'asc' ? '\u2191' : '\u2193')}
                            </th>
                            <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => handleContentSort('comments')}>
                                Comments {contentSortKey === 'comments' && (contentSortOrder === 'asc' ? '\u2191' : '\u2193')}
                            </th>
                            <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => handleContentSort('engagementRate')}>
                                Eng. Rate {contentSortKey === 'engagementRate' && (contentSortOrder === 'asc' ? '\u2191' : '\u2193')}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {sorted.length === 0 ? (
                            <tr><td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>No posts match the selected filter.</td></tr>
                        ) : sorted.map(post => (
                            <tr key={post.id}>
                                <td style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    <a href={post.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}>
                                        {post.title || post.description || 'Untitled'}
                                    </a>
                                    <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                                        {post.mediaType === 'VIDEO' || post.mediaType === 'SHORT' ? 'Video' : 'Static'}
                                    </div>
                                </td>
                                <td>
                                    <span style={{ color: getPlatformColor(post.platform), fontWeight: 500, textTransform: 'capitalize' }}>
                                        {post.platform}
                                    </span>
                                </td>
                                <td style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                    {format(parseISO(post.publishedAt), 'MMM d, yyyy')}
                                </td>
                                <td style={{ textAlign: 'right' }}>{formatNumber(post.views)}</td>
                                <td style={{ textAlign: 'right' }}>{formatNumber(post.likes)}</td>
                                <td style={{ textAlign: 'right' }}>{formatNumber(post.comments)}</td>
                                <td style={{ textAlign: 'right' }}>
                                    <span style={{
                                        padding: '2px 8px', borderRadius: '6px', fontSize: '0.8125rem', fontWeight: 500,
                                        background: post.engagementRate >= 5 ? 'rgba(34,197,94,0.15)' : post.engagementRate >= 2 ? 'rgba(234,179,8,0.15)' : 'rgba(255,255,255,0.05)',
                                        color: post.engagementRate >= 5 ? '#22c55e' : post.engagementRate >= 2 ? '#eab308' : 'var(--text-muted)',
                                    }}>
                                        {post.engagementRate.toFixed(1)}%
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table></div>
            </div>
        </>
    );
}
