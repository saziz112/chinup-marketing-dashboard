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
import { gradeIGMetric, generateNudges, type MetricGrade as IGMetricGrade } from '@/lib/ig-benchmarks';
import { generateCoachingPlan, type CoachingPlan } from '@/lib/ig-coaching';
import { generateYTCoachingPlan } from '@/lib/yt-coaching';

/* ── Shared Types ────────────────────────────────────────────────── */

export type Period = '7d' | '30d' | '90d';
export type PlatformTab = 'All Platforms' | 'Instagram' | 'Inbox' | 'Facebook' | 'YouTube' | 'Repurposing';

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
        saveRate: number;
        sendRate: number;
    };
    commentReplyStats?: {
        totalComments: number;
        replied: number;
        unreplied: number;
        replyRate: number;
        avgResponseHours: number | null;
    };
    unrepliedInbox?: Array<{
        commentId: string;
        text: string;
        username: string;
        timestamp: string;
        postId: string;
        postCaption: string;
        postMediaType: string;
        postPermalink: string;
        postTimestamp: string;
    }>;
    aiCoachingPlan?: CoachingPlan | null;
    priorPeriod?: {
        totalReach: number;
        totalViews: number;
        totalInteractions: number;
        engagementRate: number;
        saveRate: number;
        sendRate: number;
    };
    deltas?: {
        viewsPct: number;
        reachPct: number;
        interactionsPct: number;
        engagementRatePct: number;
        saveRatePct: number;
        sendRatePct: number;
    };
    cadence?: {
        postsLast7d: number;
        postsLast30d: number;
        reelsLast7d: number;
        reelsLast30d: number;
        carouselsLast7d: number;
        photosLast7d: number;
        feedPostsPerWeek: number;
        reelsPerWeek: number;
        carouselMixPercent: number;
        storiesActive: number;
    };
    contentMix?: {
        reels: number;
        carousels: number;
        photos: number;
    };
    stories?: Array<{
        id: string;
        mediaType: 'IMAGE' | 'VIDEO' | 'STORY';
        mediaUrl: string;
        thumbnailUrl?: string;
        permalink: string;
        timestamp: string;
        reach: number;
        replies: number;
        navigationForward: number;
        navigationBack: number;
        navigationExited: number;
        navigationNext: number;
    }>;
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
        engagementRate: number;
        unrepliedCount?: number;
        avgReplyHours?: number | null;
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
    aiCoachingPlan?: CoachingPlan | null;
    days?: number;
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
    aiCoachingPlan?: CoachingPlan | null;
    days?: number;
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
    const ytDays = ytData!.days || (period === '7d' ? 7 : period === '90d' ? 90 : 30);

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
            {/* YT Coach Panel */}
            <CoachingPanel
                platformLabel="YouTube"
                plan={generateYTCoachingPlan({
                    videosInPeriod: ytData?.videosInPeriod || 0,
                    days: ytDays,
                    shortsCount: s.shortsCount,
                    longFormCount: s.longFormCount,
                    engagementRate: s.engagementRate,
                    avgViewsPerVideo: s.avgViewsPerVideo,
                    recentVideoViews: s.recentVideoViews,
                    subscribers: s.subscribers,
                })}
                aiPlan={ytData!.aiCoachingPlan}
            />

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

/* ── Instagram Manager Scorecard ─────────────────────────────────── */

function ScoreDot({ grade }: { grade: IGMetricGrade | null }) {
    if (!grade) return null;
    return (
        <span title={grade.label} style={{
            width: 8, height: 8, borderRadius: '50%', display: 'inline-block',
            background: grade.color, flexShrink: 0,
        }} />
    );
}

function DeltaPill({ pct }: { pct: number | undefined }) {
    if (pct === undefined || pct === null) return null;
    const positive = pct >= 0;
    return (
        <span style={{
            fontSize: 11, color: positive ? '#22c55e' : '#ef4444', fontWeight: 500,
        }}>
            {positive ? '+' : ''}{pct}% vs prev
        </span>
    );
}

interface IGScorecardProps {
    cadence: NonNullable<IGData['cadence']>;
    summary: NonNullable<IGData['summary']>;
    deltas: IGData['deltas'];
    commentReplyStats?: IGData['commentReplyStats'];
}

export function IGScorecard({ cadence, summary, deltas, commentReplyStats }: IGScorecardProps) {
    const reelsGrade = gradeIGMetric('reelsPerWeek', cadence.reelsPerWeek);
    const postsGrade = gradeIGMetric('feedPostsPerWeek', cadence.feedPostsPerWeek);
    const carouselGrade = gradeIGMetric('carouselMixPercent', cadence.carouselMixPercent);
    const storiesGrade = gradeIGMetric('storiesPerDay', cadence.storiesActive);
    const erGrade = gradeIGMetric('engagementRate', summary.engagementRate);
    const saveGrade = gradeIGMetric('saveRate', summary.saveRate);
    const sendGrade = gradeIGMetric('sendRate', summary.sendRate);
    const replyGrade = commentReplyStats && commentReplyStats.totalComments > 0
        ? gradeIGMetric('commentReplyRate', commentReplyStats.replyRate)
        : null;
    const replyHoursGrade = commentReplyStats?.avgResponseHours != null
        ? gradeIGMetric('avgReplyHours', commentReplyStats.avgResponseHours)
        : null;

    const cards = [
        { label: 'Reels / week', value: `${cadence.reelsPerWeek}`, sub: 'Last 30d avg', grade: reelsGrade,
            tooltip: 'Posting fewer than 3 Reels/week causes algorithm deprioritization. Target: 4+/week.' },
        { label: 'Posts / week', value: `${cadence.feedPostsPerWeek}`, sub: 'Last 30d avg', grade: postsGrade,
            tooltip: 'Total feed posts (Reels + Carousels + Photos) per week. Target: 4–5/week.' },
        { label: 'Stories today', value: `${cadence.storiesActive}`, sub: 'Active right now', grade: storiesGrade,
            tooltip: 'Stories drive 3–5x higher CTR than bio links and keep you in followers\' top-of-feed. Target: 3+/day.' },
        { label: 'Carousel mix', value: `${cadence.carouselMixPercent}%`, sub: 'of feed posts', grade: carouselGrade,
            tooltip: 'Carousels have the highest engagement rate of any IG format in 2026 (~1.92% avg). Target: 30%+.' },
        { label: 'Engagement rate', value: `${summary.engagementRate}%`, sub: undefined, grade: erGrade,
            tooltip: 'Interactions / Reach. 2026 industry: 1–2% avg, 3–6% good, 6%+ excellent. Beauty industry skews lower (0.3–1%).',
            delta: deltas?.engagementRatePct },
        { label: 'Save rate', value: `${summary.saveRate}%`, sub: 'Saves / Reach', grade: saveGrade,
            tooltip: 'Top algorithm signal in 2026. CTAs like "Save for your consult" boost this.',
            delta: deltas?.saveRatePct },
        { label: 'Send rate', value: `${summary.sendRate}%`, sub: 'Shares / Reach', grade: sendGrade,
            tooltip: 'Sends (DM shares) are the strongest sharability signal. Make content people want to send to a friend.',
            delta: deltas?.sendRatePct },
    ];

    if (commentReplyStats && commentReplyStats.totalComments > 0) {
        cards.push({
            label: 'Reply rate',
            value: `${commentReplyStats.replyRate}%`,
            sub: `${commentReplyStats.replied} of ${commentReplyStats.totalComments}`,
            grade: replyGrade,
            tooltip: 'Percentage of comments on recent posts that got a reply. Replying within an hour boosts post velocity in the algorithm. Target: 80%+.',
        });
        if (commentReplyStats.avgResponseHours != null) {
            const h = commentReplyStats.avgResponseHours;
            const display = h < 1 ? `${Math.round(h * 60)}m` : h < 24 ? `${h.toFixed(1)}h` : `${Math.round(h / 24)}d`;
            cards.push({
                label: 'Avg reply time',
                value: display,
                sub: 'after comment',
                grade: replyHoursGrade,
                tooltip: 'Average time between someone commenting and you replying. Replies under 1h boost post engagement signals. Target: <2h.',
            });
        }
    }

    return (
        <div className="section-card" style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 style={{ margin: 0 }}>Instagram Health</h3>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>vs. 2026 Med Spa benchmarks</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                {cards.map((c, i) => (
                    <div key={i} title={c.tooltip} style={{
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid var(--border)',
                        borderRadius: 8,
                        padding: 12,
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>{c.label}</span>
                            <ScoreDot grade={c.grade} />
                        </div>
                        <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>{c.value}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, minHeight: 14 }}>
                            {'delta' in c && c.delta !== undefined ? <DeltaPill pct={c.delta} /> : c.sub}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

interface ContentMixBarProps {
    contentMix: NonNullable<IGData['contentMix']>;
}

export function ContentMixBar({ contentMix }: ContentMixBarProps) {
    const segments = [
        { label: 'Reels', pct: contentMix.reels, color: '#E1306C' },
        { label: 'Carousels', pct: contentMix.carousels, color: '#22c55e' },
        { label: 'Photos', pct: contentMix.photos, color: '#60A5FA' },
    ].filter(s => s.pct > 0);

    if (segments.length === 0) {
        return (
            <div className="section-card" style={{ marginBottom: 24 }}>
                <h3 style={{ margin: '0 0 8px 0' }}>Content Mix (last 30d)</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>No posts in the last 30 days.</p>
            </div>
        );
    }

    return (
        <div className="section-card" style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 style={{ margin: 0 }}>Content Mix</h3>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>last 30 days</span>
            </div>
            <div style={{
                display: 'flex', height: 32, borderRadius: 6, overflow: 'hidden',
                border: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)',
            }}>
                {segments.map(s => (
                    <div key={s.label} title={`${s.label}: ${s.pct}%`} style={{
                        flexBasis: `${s.pct}%`, background: s.color,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: 'white', fontSize: 11, fontWeight: 600,
                    }}>
                        {s.pct >= 8 ? `${s.pct}%` : ''}
                    </div>
                ))}
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
                {segments.map(s => (
                    <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color }} />
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            {s.label} <strong style={{ color: 'var(--text-primary)' }}>{s.pct}%</strong>
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

interface CoachingBannerProps {
    cadence: NonNullable<IGData['cadence']>;
    summary: NonNullable<IGData['summary']>;
    deltas: IGData['deltas'];
    commentReplyStats?: IGData['commentReplyStats'];
}

export function CoachingBanner({ cadence, summary, deltas, commentReplyStats }: CoachingBannerProps) {
    const nudges = generateNudges({
        reelsPerWeek: cadence.reelsPerWeek,
        feedPostsPerWeek: cadence.feedPostsPerWeek,
        carouselMixPercent: cadence.carouselMixPercent,
        storiesActive: cadence.storiesActive,
        saveRate: summary.saveRate,
        sendRate: summary.sendRate,
        replyRate: commentReplyStats?.replyRate,
        avgReplyHours: commentReplyStats?.avgResponseHours,
        totalComments: commentReplyStats?.totalComments,
        saveRateDeltaPct: deltas?.saveRatePct,
        sendRateDeltaPct: deltas?.sendRatePct,
        engagementRateDeltaPct: deltas?.engagementRatePct,
    });

    if (nudges.length === 0) {
        return (
            <div className="section-card" style={{
                marginBottom: 24,
                background: 'rgba(34, 197, 94, 0.05)',
                border: '1px solid rgba(34, 197, 94, 0.2)',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 18 }}>✓</span>
                    <div>
                        <strong style={{ color: '#22c55e' }}>On track</strong>
                        <span style={{ color: 'var(--text-muted)', fontSize: 13, marginLeft: 8 }}>
                            All scorecard metrics meet or exceed 2026 benchmarks for medspa Instagram.
                        </span>
                    </div>
                </div>
            </div>
        );
    }

    const severityColor: Record<string, string> = {
        critical: '#ef4444',
        warning: '#f59e0b',
        info: '#60a5fa',
    };

    return (
        <div style={{ marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {nudges.map((n, i) => {
                const color = severityColor[n.severity];
                return (
                    <div key={i} className="section-card" style={{
                        background: `${color}10`, border: `1px solid ${color}40`, marginBottom: 0,
                    }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                            <span style={{ fontSize: 16, lineHeight: '20px' }}>
                                {n.severity === 'critical' ? '⚠' : n.severity === 'warning' ? '!' : 'ℹ'}
                            </span>
                            <div style={{ flex: 1 }}>
                                <div style={{ color, fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{n.title}</div>
                                <div style={{ color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.5 }}>{n.body}</div>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

/* ── Top / Bottom Posts Leaderboard ──────────────────────────────── */

interface TopBottomPostsProps {
    posts: NonNullable<IGData['posts']>;
}

export function TopBottomPosts({ posts }: TopBottomPostsProps) {
    const [showBottom, setShowBottom] = React.useState(false);

    // Filter to posts with reach data, then sort by ER
    const ranked = posts
        .filter(p => p.reach > 0)
        .sort((a, b) => b.engagementRate - a.engagementRate);

    if (ranked.length < 3) return null;

    const top3 = ranked.slice(0, 3);
    const bottom3 = ranked.slice(-3).reverse();

    const renderCard = (post: NonNullable<IGData['posts']>[number], rank: number, isBottom: boolean) => {
        const typeBadge = post.mediaType === 'VIDEO' ? 'Reel' : post.mediaType === 'CAROUSEL_ALBUM' ? 'Carousel' : 'Photo';
        const typeColor = post.mediaType === 'VIDEO' ? '#E1306C' : post.mediaType === 'CAROUSEL_ALBUM' ? '#22c55e' : '#60A5FA';
        return (
            <a key={post.id} href={post.permalink} target="_blank" rel="noopener noreferrer" style={{
                background: 'rgba(255,255,255,0.03)',
                border: `1px solid ${isBottom ? 'rgba(239,68,68,0.2)' : 'var(--border)'}`,
                borderRadius: 12,
                padding: 12,
                textDecoration: 'none',
                color: 'inherit',
                display: 'block',
                transition: 'all 0.15s ease',
            }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = isBottom ? '#ef4444' : 'var(--accent-primary)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = isBottom ? 'rgba(239,68,68,0.2)' : 'var(--border)'; }}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>#{rank}</span>
                    <span style={{
                        fontSize: 10, padding: '2px 6px', borderRadius: 999,
                        background: `${typeColor}22`, color: typeColor, fontWeight: 600,
                    }}>{typeBadge}</span>
                </div>
                <div style={{
                    fontSize: 13, lineHeight: 1.4, marginBottom: 8,
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                    color: 'var(--text-primary)',
                }}>
                    {post.caption || '(no caption)'}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{
                        fontSize: 14, fontWeight: 700,
                        color: post.engagementRate >= 5 ? '#22c55e' : post.engagementRate >= 2 ? '#eab308' : '#ef4444',
                    }}>
                        {post.engagementRate.toFixed(1)}% ER
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {formatNumber(post.reach)} reach
                    </span>
                </div>
            </a>
        );
    };

    return (
        <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 style={{ margin: 0 }}>Top 3 Posts by Engagement Rate</h3>
                <button
                    onClick={() => setShowBottom(!showBottom)}
                    style={{
                        background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)',
                        padding: '4px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                    }}
                >
                    {showBottom ? 'Hide' : 'Show'} bottom 3
                </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
                {top3.map((p, i) => renderCard(p, i + 1, false))}
            </div>
            {showBottom && (
                <>
                    <div style={{ marginTop: 16, marginBottom: 12 }}>
                        <h4 style={{ margin: 0, color: '#ef4444' }}>Bottom 3 — Review for content lessons</h4>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
                        {bottom3.map((p, i) => renderCard(p, ranked.length - i, true))}
                    </div>
                </>
            )}
        </div>
    );
}

/* ── Active Stories ──────────────────────────────────────────────── */

interface ActiveStoriesProps {
    stories: NonNullable<IGData['stories']>;
}

export function ActiveStories({ stories }: ActiveStoriesProps) {
    if (stories.length === 0) {
        return (
            <div className="section-card" style={{ marginBottom: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <h3 style={{ margin: 0 }}>Stories — Active</h3>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>last 24h</span>
                </div>
                <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
                    No active Stories. Stories drive 3–5x higher CTR than bio links — post one to keep your account top-of-feed.
                </p>
            </div>
        );
    }

    // Sort by reach descending
    const ranked = [...stories].sort((a, b) => b.reach - a.reach);
    const totalReach = stories.reduce((s, x) => s + x.reach, 0);
    const totalReplies = stories.reduce((s, x) => s + x.replies, 0);
    const totalExits = stories.reduce((s, x) => s + x.navigationExited + x.navigationNext, 0);
    const totalForwards = stories.reduce((s, x) => s + x.navigationForward, 0);
    // Completion rate ≈ forwards / (forwards + exits) — i.e. how many people stayed vs left
    const completionRate = (totalForwards + totalExits) > 0
        ? Math.round((totalForwards / (totalForwards + totalExits)) * 100)
        : 0;

    return (
        <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 style={{ margin: 0 }}>Stories — Active ({stories.length})</h3>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>last 24h</span>
            </div>
            {/* Story-level summary */}
            <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 12 }}>
                <div className="metric-card" title="Total reach across all currently active Stories">
                    <div className="label">Total Reach</div>
                    <div className="value">{formatNumber(totalReach)}</div>
                </div>
                <div className="metric-card" title="Total replies sent to all active Stories">
                    <div className="label">Replies</div>
                    <div className="value">{formatNumber(totalReplies)}</div>
                </div>
                <div className="metric-card" title="Forwards / (Forwards + Exits) — measures how many viewers stay vs drop off">
                    <div className="label">Completion Rate</div>
                    <div className="value">{completionRate}%</div>
                </div>
            </div>
            {/* Individual stories grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
                {ranked.map(story => {
                    const thumb = story.thumbnailUrl || (story.mediaType === 'IMAGE' ? story.mediaUrl : '');
                    const exits = story.navigationExited + story.navigationNext;
                    return (
                        <a key={story.id} href={story.permalink} target="_blank" rel="noopener noreferrer" style={{
                            background: 'rgba(255,255,255,0.03)',
                            border: '1px solid var(--border)',
                            borderRadius: 8,
                            overflow: 'hidden',
                            textDecoration: 'none',
                            color: 'inherit',
                            display: 'block',
                        }}>
                            {thumb ? (
                                // Story preview thumbnail (9:16 aspect)
                                <div style={{
                                    background: '#000',
                                    aspectRatio: '9 / 16',
                                    backgroundImage: `url(${thumb})`,
                                    backgroundSize: 'cover',
                                    backgroundPosition: 'center',
                                }} />
                            ) : (
                                <div style={{
                                    aspectRatio: '9 / 16',
                                    background: 'rgba(225, 48, 108, 0.15)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    color: '#E1306C', fontWeight: 600, fontSize: 12,
                                }}>
                                    {story.mediaType === 'VIDEO' ? '▶ Video' : 'Story'}
                                </div>
                            )}
                            <div style={{ padding: 8 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                                    <span style={{ color: 'var(--text-muted)' }}>Reach</span>
                                    <strong>{formatNumber(story.reach)}</strong>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                                    <span style={{ color: 'var(--text-muted)' }}>Replies</span>
                                    <strong>{formatNumber(story.replies)}</strong>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                                    <span style={{ color: 'var(--text-muted)' }}>Exits</span>
                                    <strong style={{ color: exits > story.navigationForward ? '#ef4444' : 'var(--text-primary)' }}>
                                        {formatNumber(exits)}
                                    </strong>
                                </div>
                            </div>
                        </a>
                    );
                })}
            </div>
        </div>
    );
}

/* ── Inbox: Unreplied Comments ───────────────────────────────────── */

interface InboxTabProps {
    unrepliedInbox: NonNullable<IGData['unrepliedInbox']>;
}

function timeAgo(iso: string): string {
    const ms = Date.now() - new Date(iso).getTime();
    const minutes = Math.floor(ms / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    const weeks = Math.floor(days / 7);
    if (weeks < 5) return `${weeks}w ago`;
    return `${Math.floor(days / 30)}mo ago`;
}

export function InboxTab({ unrepliedInbox }: InboxTabProps) {
    const [search, setSearch] = React.useState('');

    const filtered = unrepliedInbox.filter(c =>
        search === '' ||
        c.text.toLowerCase().includes(search.toLowerCase()) ||
        c.username.toLowerCase().includes(search.toLowerCase()) ||
        c.postCaption.toLowerCase().includes(search.toLowerCase())
    );

    if (unrepliedInbox.length === 0) {
        return (
            <div className="section-card" style={{
                background: 'rgba(34, 197, 94, 0.05)',
                border: '1px solid rgba(34, 197, 94, 0.2)',
                padding: '32px 24px',
                textAlign: 'center',
            }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>✓</div>
                <h3 style={{ color: '#22c55e', margin: '0 0 8px 0' }}>All caught up</h3>
                <p style={{ color: 'var(--text-muted)', margin: 0 }}>
                    No unreplied comments on recent posts. Replying to comments boosts post velocity in the algorithm.
                </p>
            </div>
        );
    }

    return (
        <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
                <div>
                    <h2 style={{ margin: 0 }}>{unrepliedInbox.length} Unreplied Comment{unrepliedInbox.length === 1 ? '' : 's'}</h2>
                    <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 0 0' }}>
                        Across {new Set(unrepliedInbox.map(c => c.postId)).size} recent post{new Set(unrepliedInbox.map(c => c.postId)).size === 1 ? '' : 's'} • newest first
                    </p>
                </div>
                <input
                    type="text"
                    placeholder="Search comments, usernames, or post captions..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    style={{
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-primary)',
                        padding: '8px 12px',
                        borderRadius: 8,
                        fontSize: 13,
                        minWidth: 280,
                    }}
                />
            </div>

            {filtered.length === 0 ? (
                <div className="section-card">
                    <p style={{ color: 'var(--text-muted)', margin: 0, textAlign: 'center' }}>
                        No comments match &ldquo;{search}&rdquo;.
                    </p>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {filtered.map(c => {
                        const typeBadge = c.postMediaType === 'VIDEO' ? 'Reel' : c.postMediaType === 'CAROUSEL_ALBUM' ? 'Carousel' : 'Photo';
                        const typeColor = c.postMediaType === 'VIDEO' ? '#E1306C' : c.postMediaType === 'CAROUSEL_ALBUM' ? '#22c55e' : '#60A5FA';
                        return (
                            <div key={c.commentId} className="section-card" style={{
                                marginBottom: 0, padding: 14,
                                display: 'flex', gap: 12, alignItems: 'flex-start',
                            }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                                        <strong style={{ color: 'var(--text-primary)', fontSize: 14 }}>@{c.username}</strong>
                                        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{timeAgo(c.timestamp)}</span>
                                        <span style={{
                                            fontSize: 10, padding: '1px 6px', borderRadius: 999,
                                            background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', fontWeight: 600,
                                        }}>UNREPLIED</span>
                                    </div>
                                    <div style={{
                                        color: 'var(--text-primary)', fontSize: 14, lineHeight: 1.5,
                                        marginBottom: 8, wordBreak: 'break-word',
                                    }}>
                                        {c.text || <em style={{ color: 'var(--text-muted)' }}>(no text — likely media-only)</em>}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                                        <span style={{
                                            fontSize: 10, padding: '1px 6px', borderRadius: 999,
                                            background: `${typeColor}22`, color: typeColor, fontWeight: 600,
                                        }}>{typeBadge}</span>
                                        <span style={{
                                            maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                        }}>
                                            on: {c.postCaption || <em>(no caption)</em>}
                                        </span>
                                        <span>•</span>
                                        <span>{timeAgo(c.postTimestamp)}</span>
                                    </div>
                                </div>
                                <a href={c.postPermalink} target="_blank" rel="noopener noreferrer" style={{
                                    background: 'var(--accent-primary)',
                                    color: 'white',
                                    padding: '8px 14px',
                                    borderRadius: 8,
                                    fontSize: 13,
                                    fontWeight: 500,
                                    textDecoration: 'none',
                                    whiteSpace: 'nowrap',
                                    flexShrink: 0,
                                }}>
                                    Reply on IG →
                                </a>
                            </div>
                        );
                    })}
                </div>
            )}
        </>
    );
}

/* ── Coaching Panel: directional, growth-oriented guidance ───────── */

interface CoachingPanelProps {
    plan: CoachingPlan;        // rule-based plan (always available)
    aiPlan?: CoachingPlan | null; // AI-generated plan (preferred when present)
    platformLabel?: string;    // "Instagram" | "Facebook" | "YouTube"
}

const SKILL_LEVEL_BADGE: Record<string, { label: string; color: string }> = {
    foundational: { label: 'Foundational', color: '#60A5FA' },
    intermediate: { label: 'Intermediate', color: '#a78bfa' },
    advanced:     { label: 'Advanced',     color: '#22c55e' },
};

export function CoachingPanel({ plan: rulePlan, aiPlan, platformLabel }: CoachingPanelProps) {
    // Prefer AI plan if it loaded successfully; otherwise fall back to rule-based.
    const plan: CoachingPlan = aiPlan ?? rulePlan;
    const isAI = !!aiPlan;

    const skillBadge = SKILL_LEVEL_BADGE[plan.nextSkill.level] || SKILL_LEVEL_BADGE.intermediate;

    return (
        <div className="section-card" style={{
            marginBottom: 24,
            background: 'linear-gradient(135deg, rgba(168, 139, 250, 0.06) 0%, rgba(96, 165, 250, 0.04) 100%)',
            border: '1px solid rgba(168, 139, 250, 0.2)',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <h3 style={{ margin: 0 }}>{platformLabel ? `${platformLabel} Coach` : 'Coach'}</h3>
                        {isAI && (
                            <span title="Generated by Claude based on your specific posts and metrics" style={{
                                fontSize: 10, padding: '2px 8px', borderRadius: 999,
                                background: 'linear-gradient(135deg, #a78bfa22, #60A5FA22)',
                                border: '1px solid #a78bfa44',
                                color: '#a78bfa', fontWeight: 600, letterSpacing: '0.04em',
                            }}>AI</span>
                        )}
                    </div>
                    <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: '2px 0 0 0' }}>
                        {isAI
                            ? 'Personalized by Claude based on your top performers and current metrics'
                            : 'Personalized direction based on this period’s data'}
                    </p>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
                {/* What's Working */}
                <div style={{
                    background: 'rgba(34, 197, 94, 0.06)',
                    border: '1px solid rgba(34, 197, 94, 0.2)',
                    borderRadius: 8,
                    padding: 14,
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                        <span style={{ fontSize: 16 }}>✓</span>
                        <strong style={{ color: '#22c55e', fontSize: 14 }}>What&apos;s Working</strong>
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-primary)', fontSize: 13, lineHeight: 1.6 }}>
                        {plan.strengths.map((s, i) => (
                            <li key={i} style={{ marginBottom: 8 }}>
                                <strong>{s.label}</strong>
                                <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2 }}>{s.detail}</div>
                            </li>
                        ))}
                    </ul>
                </div>

                {/* Focus This Week */}
                <div style={{
                    background: 'rgba(96, 165, 250, 0.06)',
                    border: '1px solid rgba(96, 165, 250, 0.2)',
                    borderRadius: 8,
                    padding: 14,
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                        <span style={{ fontSize: 16 }}>→</span>
                        <strong style={{ color: '#60A5FA', fontSize: 14 }}>Focus This Week</strong>
                    </div>
                    <ol style={{ margin: 0, paddingLeft: 18, color: 'var(--text-primary)', fontSize: 13, lineHeight: 1.6 }}>
                        {plan.focusThisWeek.map((f, i) => (
                            <li key={i} style={{ marginBottom: 10 }}>
                                <strong>{f.title}</strong>
                                <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2 }}>{f.action}</div>
                                <div style={{
                                    color: '#60A5FA', fontSize: 11.5, marginTop: 4,
                                    fontStyle: 'italic', lineHeight: 1.5,
                                }}>
                                    Example: {f.example}
                                </div>
                            </li>
                        ))}
                    </ol>
                </div>

                {/* Skill to Build */}
                <div style={{
                    background: 'rgba(168, 139, 250, 0.06)',
                    border: '1px solid rgba(168, 139, 250, 0.2)',
                    borderRadius: 8,
                    padding: 14,
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 16 }}>★</span>
                        <strong style={{ color: '#a78bfa', fontSize: 14 }}>Skill to Build</strong>
                        <span style={{
                            fontSize: 10, padding: '1px 7px', borderRadius: 999,
                            background: `${skillBadge.color}22`, color: skillBadge.color, fontWeight: 600,
                            marginLeft: 'auto',
                        }}>
                            {skillBadge.label}
                        </span>
                    </div>
                    <strong style={{ color: 'var(--text-primary)', fontSize: 13, display: 'block', marginBottom: 6 }}>
                        {plan.nextSkill.title}
                    </strong>
                    <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: '0 0 10px 0', lineHeight: 1.5 }}>
                        {plan.nextSkill.why}
                    </p>
                    <div style={{ fontSize: 11.5, color: '#a78bfa', fontWeight: 600, marginBottom: 4 }}>
                        How to build it:
                    </div>
                    <ol style={{ margin: 0, paddingLeft: 18, color: 'var(--text-primary)', fontSize: 12, lineHeight: 1.6 }}>
                        {plan.nextSkill.how.map((step, i) => (
                            <li key={i} style={{ marginBottom: 4 }}>{step}</li>
                        ))}
                    </ol>
                </div>
            </div>
        </div>
    );
}

/* ── Repurposing Tab: cross-platform tracker ─────────────────────── */

export interface RepurposingItem {
    igPostId: string;
    igCaption: string;
    igPermalink: string;
    igTimestamp: string;
    igMediaType: string;
    igReach: number;
    igViews: number;
    igEngagementRate: number;
    isVideo: boolean;
    ytMatch: {
        videoId: string;
        title: string;
        publishedAt: string;
        viewCount: number;
        isShort: boolean;
        matchScore: number;
    } | null;
    crossPostStatus: 'cross-posted' | 'gap' | 'not-applicable';
}

export interface RepurposingData {
    configured: boolean;
    error?: string;
    items?: RepurposingItem[];
    stats?: {
        totalIGPosts: number;
        totalVideos: number;
        crossPostedCount: number;
        gapCount: number;
        crossPostPercent: number;
        ytConfigured: boolean;
    };
}

interface RepurposingTabProps {
    data: RepurposingData | null;
    loading: boolean;
}

export function RepurposingTab({ data, loading }: RepurposingTabProps) {
    const [filter, setFilter] = React.useState<'all' | 'gap' | 'cross-posted'>('gap');

    if (loading || !data) {
        return (
            <div className="section-card">
                <div className="empty-state">
                    <h3>Loading repurposing data…</h3>
                </div>
            </div>
        );
    }

    if (data.error) {
        return (
            <div className="section-card">
                <div className="empty-state">
                    <h3>Couldn&apos;t load repurposing data</h3>
                    <p>{data.error}</p>
                </div>
            </div>
        );
    }

    const items = data.items || [];
    const stats = data.stats;

    if (!stats || items.length === 0) {
        return (
            <div className="section-card">
                <div className="empty-state">
                    <h3>No data yet</h3>
                    <p>Connect Instagram and YouTube to track cross-platform repurposing.</p>
                </div>
            </div>
        );
    }

    const filtered = items.filter(i => {
        if (filter === 'all') return i.isVideo; // Hide non-videos in "all"
        if (filter === 'gap') return i.crossPostStatus === 'gap';
        if (filter === 'cross-posted') return i.crossPostStatus === 'cross-posted';
        return true;
    });

    const showCoachingNudge = stats.totalVideos >= 5 && stats.crossPostPercent < 50;

    return (
        <>
            {/* Header stats */}
            <div className="section-card" style={{
                marginBottom: 24,
                background: stats.crossPostPercent >= 70
                    ? 'linear-gradient(135deg, rgba(34, 197, 94, 0.06) 0%, rgba(34, 197, 94, 0.02) 100%)'
                    : 'linear-gradient(135deg, rgba(225, 48, 108, 0.05) 0%, rgba(255, 0, 0, 0.04) 100%)',
                border: stats.crossPostPercent >= 70 ? '1px solid rgba(34,197,94,0.2)' : '1px solid rgba(225,48,108,0.2)',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
                    <div>
                        <h3 style={{ margin: 0 }}>Cross-Platform Repurposing</h3>
                        <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: '2px 0 0 0' }}>
                            How many of your IG videos also live on YouTube
                        </p>
                    </div>
                </div>
                <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                    <div className="metric-card" title="Percentage of IG video posts that have a corresponding YouTube video published within ±3 days">
                        <div className="label">Cross-Post Rate</div>
                        <div className="value" style={{
                            color: stats.crossPostPercent >= 70 ? '#22c55e' : stats.crossPostPercent >= 40 ? '#eab308' : '#ef4444',
                        }}>
                            {stats.crossPostPercent}%
                        </div>
                        <div className="change">{stats.crossPostedCount} of {stats.totalVideos} IG videos</div>
                    </div>
                    <div className="metric-card">
                        <div className="label">IG Videos</div>
                        <div className="value">{stats.totalVideos}</div>
                        <div className="change">in fetched window</div>
                    </div>
                    <div className="metric-card" title="IG Reels that don't have a matching YouTube upload — these are free reach being left on the table">
                        <div className="label">Cross-Post Gaps</div>
                        <div className="value" style={{ color: stats.gapCount > 0 ? '#ef4444' : 'var(--text-primary)' }}>
                            {stats.gapCount}
                        </div>
                        <div className="change">need YT upload</div>
                    </div>
                    <div className="metric-card" title="IG Reels successfully cross-posted to YouTube">
                        <div className="label">Cross-Posted</div>
                        <div className="value" style={{ color: stats.crossPostedCount > 0 ? '#22c55e' : 'var(--text-primary)' }}>
                            {stats.crossPostedCount}
                        </div>
                        <div className="change">on both platforms</div>
                    </div>
                </div>
                {showCoachingNudge && (
                    <div style={{
                        marginTop: 14,
                        padding: '10px 14px',
                        background: 'rgba(245, 158, 11, 0.08)',
                        border: '1px solid rgba(245, 158, 11, 0.25)',
                        borderRadius: 8,
                        fontSize: 13,
                        color: 'var(--text-muted)',
                        lineHeight: 1.5,
                    }}>
                        <strong style={{ color: '#f59e0b' }}>You&apos;re leaving free reach on the table.</strong>{' '}
                        Only {stats.crossPostPercent}% of your IG Reels make it to YouTube Shorts. Cross-posting takes ~5 min per Reel
                        (download without watermark → upload to YT Shorts) and 10–50x&apos;s your distribution. Goal: 80%+ cross-post rate.
                    </div>
                )}
                {!stats.ytConfigured && (
                    <div style={{
                        marginTop: 14,
                        padding: '10px 14px',
                        background: 'rgba(239, 68, 68, 0.08)',
                        border: '1px solid rgba(239, 68, 68, 0.25)',
                        borderRadius: 8,
                        fontSize: 13,
                        color: 'var(--text-muted)',
                    }}>
                        <strong style={{ color: '#ef4444' }}>YouTube not connected</strong> — all IG videos will show as gaps until YT credentials are configured.
                    </div>
                )}
            </div>

            {/* Filter buttons */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                {(['gap', 'cross-posted', 'all'] as const).map(f => {
                    const count = f === 'all' ? stats.totalVideos
                        : f === 'gap' ? stats.gapCount
                        : stats.crossPostedCount;
                    const labels = { gap: 'Gaps to fix', 'cross-posted': 'Cross-posted', all: 'All videos' };
                    return (
                        <button
                            key={f}
                            onClick={() => setFilter(f)}
                            style={{
                                background: filter === f ? 'var(--accent-primary)' : 'transparent',
                                color: filter === f ? 'white' : 'var(--text-muted)',
                                border: '1px solid var(--border)',
                                padding: '6px 14px',
                                borderRadius: 8,
                                fontSize: 13,
                                fontWeight: 500,
                                cursor: 'pointer',
                            }}
                        >
                            {labels[f]} ({count})
                        </button>
                    );
                })}
            </div>

            {/* Item list */}
            {filtered.length === 0 ? (
                <div className="section-card">
                    <div className="empty-state">
                        <h3>{filter === 'gap' ? 'No gaps — nice work' : 'Nothing here'}</h3>
                        <p>{filter === 'gap' ? 'All recent IG Reels are also on YouTube.' : 'Try a different filter.'}</p>
                    </div>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {filtered.map(item => {
                        const date = new Date(item.igTimestamp);
                        const daysAgo = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
                        const isGap = item.crossPostStatus === 'gap';
                        return (
                            <div key={item.igPostId} className="section-card" style={{
                                marginBottom: 0, padding: 14,
                                display: 'flex', gap: 12, alignItems: 'center',
                                borderColor: isGap ? 'rgba(239,68,68,0.25)' : 'var(--border)',
                            }}>
                                <div style={{
                                    width: 42, height: 42, borderRadius: 8, flexShrink: 0,
                                    background: isGap ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.12)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: 22,
                                }}>
                                    {isGap ? '!' : '✓'}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                                        <span style={{
                                            fontSize: 10, padding: '1px 6px', borderRadius: 999,
                                            background: '#E1306C22', color: '#E1306C', fontWeight: 600,
                                        }}>IG REEL</span>
                                        {isGap ? (
                                            <span style={{
                                                fontSize: 10, padding: '1px 6px', borderRadius: 999,
                                                background: '#ef444422', color: '#ef4444', fontWeight: 600,
                                            }}>GAP — NOT ON YT</span>
                                        ) : (
                                            <>
                                                <span style={{
                                                    fontSize: 10, padding: '1px 6px', borderRadius: 999,
                                                    background: '#FF000022', color: '#FF0000', fontWeight: 600,
                                                }}>YT {item.ytMatch?.isShort ? 'SHORT' : 'LONG'}</span>
                                                <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 500 }}>
                                                    ✓ Cross-posted
                                                </span>
                                            </>
                                        )}
                                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                            {daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : `${daysAgo}d ago`}
                                        </span>
                                    </div>
                                    <div style={{
                                        color: 'var(--text-primary)', fontSize: 13, lineHeight: 1.4,
                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                    }}>
                                        {item.igCaption || <em style={{ color: 'var(--text-muted)' }}>(no caption)</em>}
                                    </div>
                                    <div style={{ display: 'flex', gap: 14, marginTop: 4, fontSize: 11, color: 'var(--text-muted)' }}>
                                        <span>{formatNumber(item.igViews)} IG views</span>
                                        <span>{item.igEngagementRate.toFixed(1)}% ER</span>
                                        {item.ytMatch && <span>• {formatNumber(item.ytMatch.viewCount)} YT views</span>}
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                                    <a href={item.igPermalink} target="_blank" rel="noopener noreferrer" style={{
                                        background: 'transparent', border: '1px solid var(--border)',
                                        color: 'var(--text-muted)', padding: '6px 12px',
                                        borderRadius: 8, fontSize: 12, textDecoration: 'none', whiteSpace: 'nowrap',
                                    }}>
                                        View IG
                                    </a>
                                    {item.ytMatch && (
                                        <a href={`https://youtube.com/watch?v=${item.ytMatch.videoId}`} target="_blank" rel="noopener noreferrer" style={{
                                            background: 'transparent', border: '1px solid var(--border)',
                                            color: 'var(--text-muted)', padding: '6px 12px',
                                            borderRadius: 8, fontSize: 12, textDecoration: 'none', whiteSpace: 'nowrap',
                                        }}>
                                            View YT
                                        </a>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </>
    );
}

