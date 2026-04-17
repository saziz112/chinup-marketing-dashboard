'use client';

import { useState, useMemo } from 'react';
import {
    Clock, LayoutTemplate, ChevronLeft, ChevronRight, Plus,
    Edit3, Archive, User, MapPin, Loader2, Zap, CheckCircle, Target,
    Instagram, Facebook, Youtube, RefreshCw, AlertCircle,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { PostRecord, categorizeError } from '@/lib/content-publisher';

const bucketColor: Record<string, string> = {
    transient_meta: '#eab308',
    token_expired: '#ef4444',
    media_invalid: '#f97316',
    ratio_invalid: '#f97316',
    config_missing: '#8b5cf6',
    rate_limited: '#eab308',
    unknown: '#94a3b8',
};
import { PLATFORM_COLORS } from '@/lib/constants';
import { USERS } from '@/lib/config';

// ─── Types ──────────────────────────────────────────────────────────────────

interface GoalsData {
    weekStarting: string;
    weekEnding: string;
    targets: Record<string, { target: number; current: number; label: string }>;
    currentStreak: number;
    isOnTrack: boolean;
}

// ─── Shared Helpers ─────────────────────────────────────────────────────────

function resolveDisplayName(email?: string): string {
    if (!email) return 'Unknown';
    const user = USERS.find(u => u.email === email);
    return user?.displayName || email.split('@')[0];
}

const platformMeta: Record<string, { color: string; icon: any; label: string }> = {
    instagram: { color: PLATFORM_COLORS.instagram, icon: Instagram, label: 'Instagram' },
    facebook: { color: PLATFORM_COLORS.facebook, icon: Facebook, label: 'Facebook' },
    'google-business': { color: PLATFORM_COLORS['google-business'], icon: MapPin, label: 'Google Business' },
    youtube: { color: PLATFORM_COLORS.youtube, icon: Youtube, label: 'YouTube' },
};

// ─── Queue Calendar View ────────────────────────────────────────────────────

export function QueueCalendar({ posts, onUpdate, onEdit }: { posts: PostRecord[], onUpdate: () => void, onEdit: (post: PostRecord) => void }) {
    const now = new Date();
    const [currentMonth, setCurrentMonth] = useState(now.getMonth() + 1);
    const [currentYear, setCurrentYear] = useState(now.getFullYear());

    const handleCancel = async (id: string) => {
        try {
            await fetch(`/api/content/publish?id=${id}`, { method: 'DELETE' });
            onUpdate();
        } catch (e) {
            console.error(e);
        }
    };

    // Group posts by ET date
    const postsByDate = useMemo(() => {
        const map = new Map<string, PostRecord[]>();
        for (const post of posts) {
            if (!post.scheduledFor) continue;
            const dateStr = new Date(post.scheduledFor).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
            if (!map.has(dateStr)) map.set(dateStr, []);
            map.get(dateStr)!.push(post);
        }
        return map;
    }, [posts]);

    const goMonth = (delta: number) => {
        let m = currentMonth + delta;
        let y = currentYear;
        if (m > 12) { m = 1; y++; }
        if (m < 1) { m = 12; y--; }
        setCurrentMonth(m);
        setCurrentYear(y);
    };

    const firstDayOfWeek = new Date(currentYear, currentMonth - 1, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    const totalCells = firstDayOfWeek + daysInMonth;
    const rows = Math.ceil(totalCells / 7);
    const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const monthLabel = new Date(currentYear, currentMonth - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    const handleDayClick = (dateStr: string, dayPosts: PostRecord[]) => {
        if (dayPosts.length === 0) {
            // Create new post for this day at 10 AM ET
            const newPost: PostRecord = {
                id: '',
                platforms: [],
                caption: '',
                mediaUrls: [],
                status: 'DRAFT' as any,
                createdAt: new Date().toISOString(),
                scheduledFor: `${dateStr}T10:00:00-05:00`,
            };
            onEdit(newPost);
        }
    };

    return (
        <div>
            {/* Month Navigation */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                <button onClick={() => goMonth(-1)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px 8px' }}>
                    <ChevronLeft size={18} />
                </button>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>{monthLabel}</h3>
                <button onClick={() => goMonth(1)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px 8px' }}>
                    <ChevronRight size={18} />
                </button>
            </div>

            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0 0 12px' }}>
                Posts publish automatically at their scheduled time. All times shown in Eastern Time (ET).
            </p>

            {/* Calendar Grid */}
            <div className="queue-calendar-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }}>
                {/* Day headers */}
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                    <div key={d} className="queue-calendar-header" style={{ textAlign: 'center', fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-muted)', padding: '8px 0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{d}</div>
                ))}

                {/* Day cells */}
                {Array.from({ length: rows * 7 }, (_, i) => {
                    const dayNum = i - firstDayOfWeek + 1;
                    const isValid = dayNum >= 1 && dayNum <= daysInMonth;
                    if (!isValid) return <div key={i} style={{ minHeight: 90 }} />;

                    const dateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
                    const dayPosts = postsByDate.get(dateStr) || [];
                    const isToday = dateStr === todayStr;
                    const hasPosts = dayPosts.length > 0;

                    return (
                        <div
                            key={i}
                            onClick={() => handleDayClick(dateStr, dayPosts)}
                            style={{
                                minHeight: 90,
                                background: 'rgba(255,255,255,0.02)',
                                border: isToday ? '1px solid var(--accent)' : hasPosts ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(255,255,255,0.03)',
                                borderLeft: hasPosts ? '3px solid var(--accent)' : undefined,
                                borderRadius: 6,
                                padding: '6px',
                                cursor: 'pointer',
                                transition: 'border-color 0.15s',
                            }}
                        >
                            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: isToday ? 'var(--accent)' : 'var(--text-muted)', marginBottom: 4 }}>
                                {dayNum}
                            </div>

                            {dayPosts.slice(0, 3).map(post => {
                                const pm = platformMeta[post.platforms[0]];
                                const time = post.scheduledFor
                                    ? new Date(post.scheduledFor).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true })
                                    : '';
                                return (
                                    <div
                                        key={post.id}
                                        onClick={(e) => { e.stopPropagation(); onEdit(post); }}
                                        style={{
                                            padding: '3px 5px', borderRadius: 4, marginBottom: 2,
                                            background: 'rgba(255,255,255,0.04)', cursor: 'pointer',
                                            fontSize: '0.625rem', lineHeight: 1.3,
                                            display: 'flex', alignItems: 'center', gap: 3,
                                        }}
                                    >
                                        {pm && <pm.icon size={9} style={{ color: pm.color, flexShrink: 0 }} />}
                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#ccc', flex: 1 }}>
                                            {post.caption?.substring(0, 30) || 'No caption'}
                                        </span>
                                        <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{time}</span>
                                    </div>
                                );
                            })}

                            {dayPosts.length > 3 && (
                                <div style={{ fontSize: '0.5625rem', color: 'var(--accent)', fontWeight: 600, marginTop: 2 }}>
                                    +{dayPosts.length - 3} more
                                </div>
                            )}

                            {dayPosts.length === 0 && (
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50px', opacity: 0 }}>
                                    <Plus size={14} style={{ color: 'var(--text-muted)' }} />
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ─── Queue List (Rich Cards) — kept as fallback ─────────────────────────────

export function QueueList({ posts, onUpdate, onEdit }: { posts: PostRecord[], onUpdate: () => void, onEdit: (post: PostRecord) => void }) {
    const handleCancel = async (id: string) => {
        try {
            await fetch(`/api/content/publish?id=${id}`, { method: 'DELETE' });
            onUpdate();
        } catch (e) {
            console.error(e);
        }
    };

    if (posts.length === 0) {
        return (
            <div className="section-card" style={{ padding: '60px 32px', textAlign: 'center' }}>
                <Clock size={40} style={{ color: 'var(--text-muted)', margin: '0 auto 12px', opacity: 0.4 }} />
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9375rem' }}>No scheduled posts.</p>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '4px' }}>
                    Posts publish automatically at their scheduled time (ET).
                </p>
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0 0 4px' }}>
                Posts publish automatically at their scheduled time. All times shown in Eastern Time (ET).
            </p>
            {posts.map(post => {
                const meta = post.metadata as any;
                const gbpLocs: string[] = meta?.gbpLocations || [];
                const timeLabel = post.scheduledFor
                    ? formatDistanceToNow(new Date(post.scheduledFor), { addSuffix: true })
                    : '';

                return (
                    <div key={post.id} className="section-card" style={{ padding: '20px 24px' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
                            {/* Media thumbnail */}
                            {post.mediaUrls?.[0] && (
                                <img
                                    src={post.mediaUrls[0]}
                                    alt=""
                                    style={{ width: '60px', height: '60px', borderRadius: '8px', objectFit: 'cover', flexShrink: 0 }}
                                />
                            )}

                            <div style={{ flex: 1, minWidth: 0 }}>
                                {/* Top row: platforms + type + time */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '8px' }}>
                                    {/* Status */}
                                    <span style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '0.6875rem', fontWeight: 600, background: 'rgba(234,179,8,0.1)', color: '#eab308' }}>
                                        Queued
                                    </span>
                                    {/* Post type */}
                                    <span style={{ fontSize: '0.6875rem', fontWeight: 500, padding: '3px 8px', borderRadius: '6px', background: 'rgba(255,255,255,0.06)', color: '#ccc', textTransform: 'capitalize' }}>
                                        {post.postType || 'feed'}
                                    </span>
                                    {/* Platforms with labels */}
                                    {post.platforms.map(p => {
                                        const pm = platformMeta[p];
                                        if (!pm) return null;
                                        return (
                                            <span key={p} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', color: pm.color }}>
                                                <pm.icon size={12} /> {pm.label}
                                            </span>
                                        );
                                    })}
                                </div>

                                {/* Caption */}
                                <p style={{ margin: '0 0 8px', fontSize: '0.875rem', color: '#ddd', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                    {post.caption}
                                </p>

                                {/* Bottom row: who + when + locations */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                                    {post.createdBy && (
                                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                            <User size={11} /> {resolveDisplayName(post.createdBy)}
                                        </span>
                                    )}
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                        {post.scheduledFor ? new Date(post.scheduledFor).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) + ' ET' : ''}
                                        {timeLabel && ` (${timeLabel})`}
                                    </span>
                                    {gbpLocs.length > 0 && (
                                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', color: '#4285F4' }}>
                                            <MapPin size={11} /> {gbpLocs.join(', ')}
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Actions */}
                            <div style={{ display: 'flex', gap: '8px', flexShrink: 0, alignSelf: 'center' }}>
                                <button
                                    onClick={() => onEdit(post)}
                                    style={{ background: 'rgba(255,255,255,0.06)', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 500, padding: '6px 12px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}
                                >
                                    <Edit3 size={12} /> Edit
                                </button>
                                <button
                                    onClick={() => handleCancel(post.id)}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(239,68,68,0.7)', fontSize: '0.75rem', fontWeight: 600 }}
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// ─── History List (Rich Cards + Archive) ────────────────────────────────────

export function HistoryList({ posts, showArchived, onToggleArchived, onUpdate }: {
    posts: PostRecord[];
    showArchived: boolean;
    onToggleArchived: () => void;
    onUpdate?: () => void;
}) {
    const [statusFilter, setStatusFilter] = useState<string>('ALL');
    const [retrying, setRetrying] = useState<Record<string, boolean>>({});
    const [retryFeedback, setRetryFeedback] = useState<Record<string, { type: 'success' | 'error'; message: string }>>({});

    const handleRetry = async (postId: string) => {
        setRetrying(prev => ({ ...prev, [postId]: true }));
        setRetryFeedback(prev => { const next = { ...prev }; delete next[postId]; return next; });
        try {
            const res = await fetch('/api/content/publish/retry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: postId }),
            });
            const data = await res.json();
            if (!res.ok) {
                setRetryFeedback(prev => ({ ...prev, [postId]: { type: 'error', message: data.error || 'Retry failed' } }));
            } else if (data.status === 'PUBLISHED') {
                setRetryFeedback(prev => ({ ...prev, [postId]: { type: 'success', message: 'Retry succeeded on all platforms!' } }));
            } else if (data.status === 'PARTIAL') {
                setRetryFeedback(prev => ({ ...prev, [postId]: { type: 'success', message: 'Retry succeeded on some platforms.' } }));
            } else {
                setRetryFeedback(prev => ({ ...prev, [postId]: { type: 'error', message: 'Retry failed again — see details.' } }));
            }
            if (onUpdate) onUpdate();
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Network error';
            setRetryFeedback(prev => ({ ...prev, [postId]: { type: 'error', message: msg } }));
        } finally {
            setRetrying(prev => ({ ...prev, [postId]: false }));
        }
    };

    const statusStyles: Record<string, { bg: string; color: string; label: string }> = {
        PUBLISHED: { bg: 'rgba(34,197,94,0.1)', color: '#22c55e', label: 'Live' },
        FAILED: { bg: 'rgba(239,68,68,0.1)', color: '#ef4444', label: 'Failed' },
        PARTIAL: { bg: 'rgba(234,179,8,0.1)', color: '#eab308', label: 'Partial' },
        PUBLISHING: { bg: 'rgba(59,130,246,0.1)', color: '#3b82f6', label: 'Sending' },
        DRAFT: { bg: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)', label: 'Draft' },
    };

    const filterOptions = [
        { key: 'ALL', label: 'All', color: '#fff' },
        { key: 'PUBLISHED', label: 'Live', color: '#22c55e' },
        { key: 'FAILED', label: 'Failed', color: '#ef4444' },
        { key: 'PARTIAL', label: 'Partial', color: '#eab308' },
        { key: 'PUBLISHING', label: 'Sending', color: '#3b82f6' },
    ];

    const filteredPosts = statusFilter === 'ALL' ? posts : posts.filter(p => p.status === statusFilter);

    if (posts.length === 0) {
        return (
            <div>
                <div className="section-card" style={{ padding: '60px 32px', textAlign: 'center' }}>
                    <LayoutTemplate size={40} style={{ color: 'var(--text-muted)', margin: '0 auto 12px', opacity: 0.4 }} />
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9375rem' }}>No publishing history yet.</p>
                </div>
                <div style={{ textAlign: 'center', marginTop: '16px' }}>
                    <button onClick={onToggleArchived} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px', margin: '0 auto' }}>
                        <Archive size={12} /> {showArchived ? 'Hide Archived' : 'Show Archived'}
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div>
            {/* Status Filter Pills */}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '16px' }}>
                {filterOptions.map(opt => {
                    const count = opt.key === 'ALL' ? posts.length : posts.filter(p => p.status === opt.key).length;
                    if (opt.key !== 'ALL' && count === 0) return null;
                    const isActive = statusFilter === opt.key;
                    return (
                        <button
                            key={opt.key}
                            onClick={() => setStatusFilter(opt.key)}
                            style={{
                                padding: '5px 12px',
                                borderRadius: '20px',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                                border: `1px solid ${isActive ? opt.color : 'rgba(255,255,255,0.08)'}`,
                                background: isActive ? `${opt.color}15` : 'transparent',
                                color: isActive ? opt.color : 'var(--text-muted)',
                                transition: 'all 0.15s ease',
                            }}
                        >
                            {opt.label} ({count})
                        </button>
                    );
                })}
            </div>

            {filteredPosts.length === 0 ? (
                <div className="section-card" style={{ padding: '40px 32px', textAlign: 'center' }}>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                        No {filterOptions.find(o => o.key === statusFilter)?.label.toLowerCase()} posts.
                    </p>
                </div>
            ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {filteredPosts.map(post => {
                    const st = statusStyles[post.status] || statusStyles.DRAFT;
                    const meta = post.metadata as any;
                    const gbpLocs: string[] = meta?.gbpLocations || [];
                    const isArchived = !!post.archivedAt;
                    const errors = post.errors || {};
                    const hasErrors = Object.keys(errors).length > 0;

                    return (
                        <div key={post.id} className="section-card" style={{
                            padding: '20px 24px',
                            opacity: isArchived ? 0.5 : 1,
                        }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
                                {/* Media thumbnail */}
                                {post.mediaUrls?.[0] && (
                                    <img
                                        src={post.mediaUrls[0]}
                                        alt=""
                                        style={{ width: '50px', height: '50px', borderRadius: '8px', objectFit: 'cover', flexShrink: 0 }}
                                    />
                                )}

                                <div style={{ flex: 1, minWidth: 0 }}>
                                    {/* Top row: status + type + platforms */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' }}>
                                        <span style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '0.6875rem', fontWeight: 600, background: st.bg, color: st.color }}>
                                            {st.label}
                                        </span>
                                        {isArchived && (
                                            <span style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '0.6875rem', fontWeight: 500, background: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)' }}>
                                                Archived
                                            </span>
                                        )}
                                        {post.postType && post.postType !== 'feed' && (
                                            <span style={{ fontSize: '0.6875rem', fontWeight: 500, padding: '3px 8px', borderRadius: '6px', background: 'rgba(255,255,255,0.06)', color: '#ccc', textTransform: 'capitalize' }}>
                                                {post.postType}
                                            </span>
                                        )}
                                        {post.platforms.map(p => {
                                            const pm = platformMeta[p];
                                            if (!pm) return null;
                                            return (
                                                <span key={p} style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '0.75rem', color: pm.color }}>
                                                    <pm.icon size={12} /> {pm.label}
                                                </span>
                                            );
                                        })}
                                    </div>

                                    {/* Caption */}
                                    <p style={{ margin: '0 0 6px', fontSize: '0.8125rem', color: '#ccc', lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {post.caption}
                                    </p>

                                    {/* Bottom row: who + when + locations */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                                        {post.createdBy && (
                                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                                <User size={11} /> {resolveDisplayName(post.createdBy)}
                                            </span>
                                        )}
                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                            {post.publishedAt
                                                ? format(new Date(post.publishedAt), 'MMM d, h:mm a')
                                                : format(new Date(post.createdAt), 'MMM d')}
                                        </span>
                                        {gbpLocs.length > 0 && (
                                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', color: '#4285F4' }}>
                                                <MapPin size={11} /> {gbpLocs.join(', ')}
                                            </span>
                                        )}
                                    </div>

                                    {/* Inline errors — bucketed */}
                                    {hasErrors && (
                                        <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                            {Object.entries(errors).map(([platform, error]) => {
                                                const info = categorizeError(error as string);
                                                const color = bucketColor[info.bucket];
                                                return (
                                                    <div key={platform} style={{
                                                        padding: '10px 12px', borderRadius: '8px',
                                                        background: `${color}10`, border: `1px solid ${color}30`,
                                                    }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                                                            <AlertCircle size={12} style={{ color, flexShrink: 0 }} />
                                                            <span style={{ fontSize: '0.75rem', fontWeight: 600, color, textTransform: 'capitalize' }}>
                                                                {platform} · {info.label}
                                                            </span>
                                                            {info.retryable && (
                                                                <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                                                    · retryable
                                                                </span>
                                                            )}
                                                        </div>
                                                        <p style={{ margin: '0 0 2px', fontSize: '0.75rem', color: '#ddd', lineHeight: 1.4 }}>
                                                            {info.suggestion}
                                                        </p>
                                                        <p style={{ margin: 0, fontSize: '0.6875rem', color: 'var(--text-muted)', fontFamily: 'monospace', lineHeight: 1.4 }}>
                                                            {(error as string).substring(0, 200)}
                                                            {(error as string).length > 200 ? '…' : ''}
                                                        </p>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}

                                    {/* Retry feedback */}
                                    {retryFeedback[post.id] && (
                                        <div style={{
                                            marginTop: '8px', padding: '8px 12px', borderRadius: '8px',
                                            background: retryFeedback[post.id].type === 'success' ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
                                            border: `1px solid ${retryFeedback[post.id].type === 'success' ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
                                            fontSize: '0.75rem',
                                            color: retryFeedback[post.id].type === 'success' ? '#22c55e' : '#ef4444',
                                        }}>
                                            {retryFeedback[post.id].message}
                                        </div>
                                    )}
                                </div>

                                {/* Retry button for FAILED/PARTIAL posts */}
                                {(post.status === 'FAILED' || post.status === 'PARTIAL') && !isArchived && (
                                    <button
                                        onClick={() => handleRetry(post.id)}
                                        disabled={retrying[post.id]}
                                        style={{
                                            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                                            cursor: retrying[post.id] ? 'wait' : 'pointer', color: '#eab308',
                                            fontSize: '0.75rem', fontWeight: 600, padding: '6px 12px', borderRadius: '6px',
                                            display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0, alignSelf: 'flex-start',
                                            opacity: retrying[post.id] ? 0.6 : 1,
                                        }}
                                    >
                                        {retrying[post.id]
                                            ? <Loader2 size={12} style={{ animation: 'spin 0.8s linear infinite' }} />
                                            : <RefreshCw size={12} />}
                                        {retrying[post.id] ? 'Retrying…' : 'Retry'}
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
            )}

            {/* Show Archived Toggle */}
            <div style={{ textAlign: 'center', marginTop: '16px' }}>
                <button onClick={onToggleArchived} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px', margin: '0 auto' }}>
                    <Archive size={12} /> {showArchived ? 'Hide Archived' : 'Show Archived'}
                </button>
            </div>
        </div>
    );
}

// ─── Goals Scorecard (Redesigned — TLDR / Action-Based) ─────────────────────

export function GoalsScorecard({ goals }: { goals: GoalsData | null }) {
    if (!goals) {
        return (
            <div className="section-card" style={{ padding: '40px', textAlign: 'center' }}>
                <Loader2 size={24} style={{ color: 'var(--accent)', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
                <p style={{ color: 'var(--text-muted)' }}>Loading goals...</p>
            </div>
        );
    }

    const { targets } = goals;
    const totalDone = targets.total?.current || 0;
    const totalTarget = targets.total?.target || 7;
    const progress = Math.min((totalDone / totalTarget) * 100, 100);

    const actions: string[] = [];
    for (const [key, val] of Object.entries(targets)) {
        if (key === 'total') continue;
        const remaining = val.target - val.current;
        if (remaining > 0) {
            actions.push(`Post ${remaining} more ${val.label}`);
        }
    }

    const isComplete = actions.length === 0;
    const statusColor = isComplete ? '#22c55e' : progress >= 50 ? '#eab308' : '#ef4444';
    const statusLabel = isComplete ? 'All Done!' : progress >= 50 ? 'On Track' : 'Behind';

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '700px' }}>

            {/* TLDR Header */}
            <div className="section-card" style={{ padding: '28px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
                    <div>
                        <h3 style={{ margin: '0 0 4px 0', fontSize: '1.125rem' }}>
                            This Week&apos;s Content Goals
                        </h3>
                        <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                            {goals.weekStarting && `Week of ${format(new Date(goals.weekStarting + 'T00:00:00'), 'MMM d')} — ${format(new Date(goals.weekEnding + 'T00:00:00'), 'MMM d')}`}
                        </p>
                    </div>
                    <div style={{
                        padding: '6px 14px', borderRadius: '8px', fontSize: '0.8125rem', fontWeight: 600,
                        background: `${statusColor}15`, color: statusColor,
                    }}>
                        {statusLabel}
                    </div>
                </div>

                {/* Overall Progress Bar */}
                <div style={{ marginBottom: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                        <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Overall Progress</span>
                        <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#fff' }}>{totalDone}/{totalTarget} posts</span>
                    </div>
                    <div style={{ height: '8px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                        <div style={{
                            width: `${progress}%`, height: '100%', borderRadius: '4px',
                            background: `linear-gradient(90deg, var(--accent), ${statusColor})`,
                            transition: 'width 0.5s ease',
                        }} />
                    </div>
                </div>
            </div>

            {/* Per-Platform Breakdown */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
                {Object.entries(targets).filter(([k]) => k !== 'total').map(([key, val]) => {
                    const pm = platformMeta[key];
                    const Icon = pm?.icon || Target;
                    const pct = val.target > 0 ? Math.min((val.current / val.target) * 100, 100) : 0;
                    const done = val.current >= val.target;

                    return (
                        <div key={key} className="section-card" style={{ padding: '20px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                                <Icon size={16} style={{ color: pm?.color || 'var(--text-muted)' }} />
                                <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#ccc', textTransform: 'capitalize' }}>{val.label}</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px', marginBottom: '10px' }}>
                                <span style={{ fontSize: '1.5rem', fontWeight: 700, color: done ? '#22c55e' : '#fff' }}>{val.current}</span>
                                <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>/ {val.target}</span>
                            </div>
                            <div style={{ height: '4px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px', overflow: 'hidden' }}>
                                <div style={{ width: `${pct}%`, height: '100%', borderRadius: '2px', background: done ? '#22c55e' : (pm?.color || 'var(--accent)'), transition: 'width 0.5s ease' }} />
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Action Items */}
            {!isComplete && (
                <div className="section-card" style={{ padding: '24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                        <Zap size={16} style={{ color: 'var(--accent)' }} />
                        <h4 style={{ margin: 0, fontSize: '0.9375rem' }}>What To Do Next</h4>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {actions.map((action, i) => (
                            <div key={i} style={{
                                display: 'flex', alignItems: 'center', gap: '10px',
                                padding: '10px 14px', borderRadius: '8px', background: 'rgba(255,255,255,0.03)',
                                border: '1px solid rgba(255,255,255,0.05)',
                            }}>
                                <div style={{
                                    width: '6px', height: '6px', borderRadius: '50%',
                                    background: 'var(--accent)', flexShrink: 0,
                                }} />
                                <span style={{ fontSize: '0.875rem', color: '#ddd' }}>{action}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* All Complete */}
            {isComplete && (
                <div className="section-card" style={{
                    padding: '32px', textAlign: 'center',
                    background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.15)',
                }}>
                    <CheckCircle size={32} style={{ color: '#22c55e', margin: '0 auto 12px' }} />
                    <h4 style={{ margin: '0 0 4px', color: '#22c55e' }}>All Goals Met!</h4>
                    <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                        Great work this week! Keep the momentum going.
                    </p>
                </div>
            )}
        </div>
    );
}
