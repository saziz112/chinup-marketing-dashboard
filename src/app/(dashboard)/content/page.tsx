'use client';

import { useState, useEffect, useMemo } from 'react';
import {
    LayoutGrid, List, MessageCircle, Heart, Share2,
    Play, Eye, Loader2, ArrowUpRight, Instagram, Youtube, Clock, CalendarDays, ExternalLink, Filter, TrendingUp, Smartphone
} from 'lucide-react';
import { format, parseISO, getDay, getHours } from 'date-fns';
import { Area, AreaChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts';
import { PLATFORM_COLORS } from '@/lib/constants';

interface ContentPost {
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

const getPlatformColor = (platform: string) => PLATFORM_COLORS[platform] || '#888';

const getPlatformIcon = (platform: string, size = 16) => {
    if (platform === 'instagram') return <Instagram size={size} />;
    if (platform === 'youtube') return <Youtube size={size} />;
    return null;
};

export default function ContentPage() {
    const [posts, setPosts] = useState<ContentPost[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Filters & Sorting
    const [platformFilter, setPlatformFilter] = useState<'all' | 'instagram' | 'youtube'>('all');
    const [sortKey, setSortKey] = useState<keyof ContentPost>('publishedAt');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

    useEffect(() => {
        const fetchPosts = async () => {
            try {
                const res = await fetch('/api/content/posts');
                if (!res.ok) throw new Error('Failed to fetch content data');
                const data = await res.json();
                setPosts(data.posts || []);
            } catch (err: any) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };
        fetchPosts();
    }, []);

    // Derived State
    const { filteredAndSortedPosts, topPosts, bestTimeData, kpis } = useMemo(() => {
        let filtered = [...posts];
        if (platformFilter !== 'all') {
            filtered = filtered.filter(p => p.platform === platformFilter);
        }

        filtered.sort((a, b) => {
            const aVal = a[sortKey];
            const bVal = b[sortKey];

            if (sortKey === 'publishedAt') {
                const aTime = new Date(aVal as string).getTime();
                const bTime = new Date(bVal as string).getTime();
                return sortOrder === 'asc' ? aTime - bTime : bTime - aTime;
            }

            if (typeof aVal === 'number' && typeof bVal === 'number') {
                return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
            }

            return 0;
        });

        const topPosts = [...filtered].sort((a, b) => b.views - a.views).slice(0, 3);

        let totalEng = 0;
        let totalViews = 0;
        const platformStats: Record<string, { views: number, count: number }> = {
            instagram: { views: 0, count: 0 },
            youtube: { views: 0, count: 0 }
        };

        filtered.forEach(p => {
            totalEng += (p.likes + p.comments + p.shares);
            totalViews += p.views;

            if (platformStats[p.platform]) {
                platformStats[p.platform].views += p.views;
                platformStats[p.platform].count += 1;
            }
        });

        const overallAvgEngRate = totalViews > 0 ? (totalEng / totalViews) * 100 : 0;

        let topPlatformName = 'None';
        let highestAvgViews = 0;
        Object.keys(platformStats).forEach(key => {
            const stat = platformStats[key];
            if (stat.count > 0) {
                const avg = stat.views / stat.count;
                if (avg > highestAvgViews) {
                    highestAvgViews = avg;
                    topPlatformName = key;
                }
            }
        });

        const hourBuckets: Record<number, { engRateSum: number, count: number }> = {};
        filtered.forEach(p => {
            const h = getHours(parseISO(p.publishedAt));
            if (!hourBuckets[h]) hourBuckets[h] = { engRateSum: 0, count: 0 };
            hourBuckets[h].engRateSum += p.engagementRate;
            hourBuckets[h].count += 1;
        });

        const bestTimeData = Array.from({ length: 24 }).map((_, i) => {
            const bucket = hourBuckets[i];
            const avgRate = bucket ? (bucket.count > 0 ? bucket.engRateSum / bucket.count : 0) : 0;
            return {
                hour: format(new Date().setHours(i), 'ha'),
                engagementRate: Number(avgRate.toFixed(2))
            };
        });

        return {
            filteredAndSortedPosts: filtered,
            topPosts,
            bestTimeData,
            kpis: {
                totalAnalyzed: filtered.length,
                avgEngRate: overallAvgEngRate,
                topPlatform: topPlatformName
            }
        };

    }, [posts, platformFilter, sortKey, sortOrder]);

    const handleSort = (key: keyof ContentPost) => {
        if (sortKey === key) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(key);
            setSortOrder('desc');
        }
    };

    if (loading) {
        return (
            <div className="flex h-[60vh] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-[var(--accent)]" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="section-card">
                <h3 className="text-red-500">Error loading content</h3>
                <p>{error}</p>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="page-header flex justify-between items-center">
                <div>
                    <h1>Content Performance</h1>
                    <p className="subtitle">Analyze individual post performance across all platforms</p>
                </div>
            </div>

            {/* KPIs */}
            <div className="stats-grid">
                <div className="stat-card">
                    <div className="stat-label">
                        <List size={16} /> Posts Analyzed
                    </div>
                    <div className="stat-value">{kpis.totalAnalyzed}</div>
                </div>
                <div className="stat-card">
                    <div className="stat-label">
                        <TrendingUp size={16} /> Avg Engagement Rate
                    </div>
                    <div className="stat-value">{kpis.avgEngRate.toFixed(2)}%</div>
                </div>
                <div className="stat-card">
                    <div className="stat-label">
                        <Eye size={16} /> Top Platform (Avg Views)
                    </div>
                    <div className="stat-value" style={{ textTransform: 'capitalize' }}>
                        {kpis.topPlatform}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Top Posts Leaderboard */}
                <div className="lg:col-span-2 section-card">
                    <div className="flex items-center gap-2 mb-4">
                        <TrendingUp className="text-[var(--accent)]" />
                        <h3 className="m-0">Top Posts Leaderboard</h3>
                    </div>

                    {topPosts.length === 0 ? (
                        <p className="text-slate-400">No content available to analyze.</p>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {topPosts.map(post => (
                                <div key={post.id} className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg overflow-hidden flex flex-col">
                                    <div className="relative h-40 bg-slate-800 flex items-center justify-center">
                                        {post.thumbnailUrl ? (
                                            <img src={post.thumbnailUrl} alt="Thumbnail" className="object-cover w-full h-full opacity-80" />
                                        ) : (
                                            <Play size={32} className="text-slate-600" />
                                        )}
                                        <div className="absolute top-2 left-2 p-1.5 rounded-full bg-black/60 shadow-lg" style={{ color: getPlatformColor(post.platform) }}>
                                            {getPlatformIcon(post.platform, 14)}
                                        </div>
                                    </div>
                                    <div className="p-4 flex-1 flex flex-col">
                                        <p className="text-xs text-slate-400 mb-2">
                                            {format(parseISO(post.publishedAt), 'MMM d, yyyy')}
                                        </p>
                                        <h4 className="text-sm font-medium mb-3 line-clamp-2 leading-tight flex-1" title={post.title || post.description}>
                                            {post.title || post.description || 'Untitled'}
                                        </h4>
                                        <div className="flex items-center justify-between text-xs text-slate-300">
                                            <div className="flex items-center gap-1">
                                                <Eye size={12} className="text-[var(--accent)]" />
                                                <span>{post.views.toLocaleString()}</span>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <Heart size={12} className="text-red-400" />
                                                <span>{post.likes.toLocaleString()}</span>
                                            </div>
                                            <a href={post.url} target="_blank" rel="noreferrer" className="text-[var(--accent)] hover:underline flex items-center gap-1">
                                                View <ExternalLink size={10} />
                                            </a>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Best Time to Post */}
                <div className="section-card flex flex-col">
                    <div className="flex items-center gap-2 mb-4">
                        <Clock className="text-[var(--accent)]" />
                        <h3 className="m-0">Best Time to Post</h3>
                    </div>
                    <p className="text-sm text-slate-400 mb-6">Engagement rate by hour based on historical activity.</p>

                    <div className="flex-1 min-h-[200px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={bestTimeData}>
                                <defs>
                                    <linearGradient id="colorEng" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.8} />
                                        <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <XAxis dataKey="hour" stroke="#475569" fontSize={11} tickMargin={10} />
                                <YAxis stroke="#475569" fontSize={11} tickFormatter={(v) => `${v}%`} width={35} />
                                <RechartsTooltip
                                    contentStyle={{ backgroundColor: '#1a2332', border: '1px solid var(--border-color)', borderRadius: '8px' }}
                                    formatter={(value: any) => [`${value}%`, 'Avg Engagement']}
                                />
                                <Area type="monotone" dataKey="engagementRate" stroke="var(--accent)" fillOpacity={1} fill="url(#colorEng)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

            </div>

            {/* Unified Master Table */}
            <div className="section-card">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
                    <h3 className="m-0">All Content</h3>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '2px', background: 'rgba(255,255,255,0.05)', padding: '3px', borderRadius: '8px' }}>
                            <button
                                onClick={() => setPlatformFilter('all')}
                                style={{
                                    padding: '6px 14px', borderRadius: '6px', border: 'none', cursor: 'pointer',
                                    fontSize: '0.8125rem', transition: 'all 0.2s',
                                    background: platformFilter === 'all' ? 'rgba(255,255,255,0.12)' : 'transparent',
                                    color: platformFilter === 'all' ? '#fff' : 'var(--text-muted)',
                                    fontWeight: platformFilter === 'all' ? 600 : 400,
                                }}
                            >
                                All
                            </button>
                            <button
                                onClick={() => setPlatformFilter('instagram')}
                                style={{
                                    padding: '6px 14px', borderRadius: '6px', border: 'none', cursor: 'pointer',
                                    fontSize: '0.8125rem', transition: 'all 0.2s',
                                    display: 'flex', alignItems: 'center', gap: '4px',
                                    background: platformFilter === 'instagram' ? 'rgba(225,48,108,0.15)' : 'transparent',
                                    color: platformFilter === 'instagram' ? '#E1306C' : 'var(--text-muted)',
                                    fontWeight: platformFilter === 'instagram' ? 600 : 400,
                                }}
                            >
                                <Instagram size={14} /> IG
                            </button>
                            <button
                                onClick={() => setPlatformFilter('youtube')}
                                style={{
                                    padding: '6px 14px', borderRadius: '6px', border: 'none', cursor: 'pointer',
                                    fontSize: '0.8125rem', transition: 'all 0.2s',
                                    display: 'flex', alignItems: 'center', gap: '4px',
                                    background: platformFilter === 'youtube' ? 'rgba(255,0,0,0.15)' : 'transparent',
                                    color: platformFilter === 'youtube' ? '#FF0000' : 'var(--text-muted)',
                                    fontWeight: platformFilter === 'youtube' ? 600 : 400,
                                }}
                            >
                                <Youtube size={14} /> YT
                            </button>
                        </div>
                    </div>
                </div>

                <div className="data-table-wrapper">
                    <table className="w-full text-left text-sm whitespace-nowrap">
                        <thead className="text-slate-400 border-b border-[var(--border-color)]">
                            <tr>
                                <th className="pb-3 font-medium">Post</th>
                                <th className={`pb-3 font-medium cursor-pointer transition-colors ${sortKey === 'platform' ? 'text-white' : 'hover:text-white'}`} onClick={() => handleSort('platform')}>
                                    Platform {sortKey === 'platform' && (sortOrder === 'asc' ? '↑' : '↓')}
                                </th>
                                <th className={`pb-3 font-medium cursor-pointer transition-colors ${sortKey === 'publishedAt' ? 'text-white' : 'hover:text-white'}`} onClick={() => handleSort('publishedAt')}>
                                    Date {sortKey === 'publishedAt' && (sortOrder === 'asc' ? '↑' : '↓')}
                                </th>
                                <th className={`pb-3 font-medium cursor-pointer transition-colors text-right ${sortKey === 'views' ? 'text-white' : 'hover:text-white'}`} onClick={() => handleSort('views')}>
                                    Views {sortKey === 'views' && (sortOrder === 'asc' ? '↑' : '↓')}
                                </th>
                                <th className={`pb-3 font-medium cursor-pointer transition-colors text-right ${sortKey === 'likes' ? 'text-white' : 'hover:text-white'}`} onClick={() => handleSort('likes')}>
                                    Likes {sortKey === 'likes' && (sortOrder === 'asc' ? '↑' : '↓')}
                                </th>
                                <th className={`pb-3 font-medium cursor-pointer transition-colors text-right ${sortKey === 'comments' ? 'text-white' : 'hover:text-white'}`} onClick={() => handleSort('comments')}>
                                    Comments {sortKey === 'comments' && (sortOrder === 'asc' ? '↑' : '↓')}
                                </th>
                                <th className={`pb-3 font-medium cursor-pointer transition-colors text-right pr-4 ${sortKey === 'engagementRate' ? 'text-white' : 'hover:text-white'}`} onClick={() => handleSort('engagementRate')}>
                                    Eng. Rate {sortKey === 'engagementRate' && (sortOrder === 'asc' ? '↑' : '↓')}
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border-color)]">
                            {filteredAndSortedPosts.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="py-8 text-center text-slate-400">
                                        No posts match the selected filters.
                                    </td>
                                </tr>
                            ) : (
                                filteredAndSortedPosts.map(post => (
                                    <tr key={post.id} className="hover:bg-white/[0.02] transition-colors">
                                        <td className="py-3 max-w-[300px] truncate pr-4">
                                            <a href={post.url} target="_blank" rel="noreferrer" className="text-white hover:text-[var(--accent)] font-medium capitalize block truncate" title={post.title || post.description}>
                                                {post.title || post.description || 'Untitled Post'}
                                            </a>
                                            <div className="text-xs text-slate-500 truncate mt-1">
                                                {post.mediaType === 'VIDEO' || post.mediaType === 'SHORT' ? 'Video' : 'Static Post'}
                                            </div>
                                        </td>
                                        <td className="py-3">
                                            <div className="flex items-center gap-1.5" style={{ color: getPlatformColor(post.platform) }}>
                                                {getPlatformIcon(post.platform, 14)}
                                                <span className="capitalize">{post.platform}</span>
                                            </div>
                                        </td>
                                        <td className="py-3 text-slate-300">
                                            {format(parseISO(post.publishedAt), 'MMM d, yyyy')}
                                        </td>
                                        <td className="py-3 text-right text-slate-200">
                                            {post.views.toLocaleString()}
                                        </td>
                                        <td className="py-3 text-right text-slate-300">
                                            {post.likes.toLocaleString()}
                                        </td>
                                        <td className="py-3 text-right text-slate-400">
                                            {post.comments.toLocaleString()}
                                        </td>
                                        <td className="py-3 text-right pr-4">
                                            <span className={`px-2 py-1 rounded-md text-xs font-medium ${post.engagementRate >= 5 ? 'bg-green-500/20 text-green-400' :
                                                post.engagementRate >= 2 ? 'bg-yellow-500/20 text-yellow-400' :
                                                    'bg-slate-700 text-slate-300'
                                                }`}>
                                                {post.engagementRate.toFixed(1)}%
                                            </span>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
