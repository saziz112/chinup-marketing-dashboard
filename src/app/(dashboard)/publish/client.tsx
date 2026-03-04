'use client';

import { useState, useEffect, useRef } from 'react';
import { PostRecord, Platform } from '@/lib/content-publisher';
import {
    Calendar, CheckCircle, Clock, History, PenTool, LayoutTemplate,
    Instagram, Facebook, Youtube, Send, Loader2,
    Image as ImageIcon, Target, AlertTriangle, XCircle, Zap,
    Upload, Film, X
} from 'lucide-react';
import { format } from 'date-fns';

// ─── Types ──────────────────────────────────────────────────────────────────

interface GoalsData {
    weekStarting: string;
    weekEnding: string;
    targets: Record<string, { target: number; current: number; label: string }>;
    currentStreak: number;
    isOnTrack: boolean;
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function PublishDashboardClient() {
    const [activeTab, setActiveTab] = useState<'create' | 'scheduled' | 'history' | 'goals'>('create');
    const [posts, setPosts] = useState<PostRecord[]>([]);
    const [goals, setGoals] = useState<GoalsData | null>(null);
    const [loading, setLoading] = useState(true);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [postsRes, goalsRes] = await Promise.all([
                fetch('/api/content/publish?type=posts'),
                fetch('/api/content/publish?type=goals')
            ]);
            const pData = await postsRes.json();
            const gData = await goalsRes.json();

            if (pData.posts) setPosts(pData.posts);
            if (gData.goals) setGoals(gData.goals);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchData(); }, []);

    const scheduled = posts.filter(p => p.status === 'SCHEDULED');
    const history = posts.filter(p => p.status !== 'SCHEDULED');

    const tabStyle = (active: boolean): React.CSSProperties => ({
        display: 'flex', alignItems: 'center', gap: '6px',
        padding: '8px 16px', borderRadius: '10px', border: 'none', cursor: 'pointer',
        fontSize: '0.8125rem', fontWeight: active ? 600 : 400,
        background: active ? 'rgba(255,255,255,0.1)' : 'transparent',
        color: active ? '#fff' : 'var(--text-muted)',
        transition: 'all 0.2s',
    });

    return (
        <div style={{ paddingBottom: '80px' }}>
            {/* Nav Tabs */}
            <div style={{ display: 'inline-flex', gap: '2px', background: 'rgba(255,255,255,0.04)', padding: '4px', borderRadius: '12px', marginBottom: '24px' }}>
                <button onClick={() => setActiveTab('create')} style={tabStyle(activeTab === 'create')}>
                    <PenTool size={14} /> Craft Post
                </button>
                <button onClick={() => setActiveTab('scheduled')} style={tabStyle(activeTab === 'scheduled')}>
                    <Clock size={14} /> Queue ({scheduled.length})
                </button>
                <button onClick={() => setActiveTab('history')} style={tabStyle(activeTab === 'history')}>
                    <History size={14} /> History
                </button>
                <button onClick={() => setActiveTab('goals')} style={tabStyle(activeTab === 'goals')}>
                    <Target size={14} /> Goals
                </button>
            </div>

            {/* Content */}
            <div style={{ position: 'relative', minHeight: '400px' }}>
                {loading && (
                    <div style={{
                        position: 'absolute', inset: 0, zIndex: 10,
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                        background: 'rgba(11,17,33,0.6)', backdropFilter: 'blur(8px)', borderRadius: '16px',
                    }}>
                        <Loader2 size={28} style={{ color: 'var(--accent)', animation: 'spin 0.8s linear infinite', marginBottom: '12px' }} />
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Loading...</p>
                    </div>
                )}

                {activeTab === 'create' && <CreatePostForm onPostCreated={fetchData} />}
                {activeTab === 'scheduled' && <PostList posts={scheduled} emptyMessage="No scheduled posts." onUpdate={fetchData} />}
                {activeTab === 'history' && <PostList posts={history} emptyMessage="No publishing history yet." />}
                {activeTab === 'goals' && <GoalsScorecard goals={goals} />}
            </div>
        </div>
    );
}

// ─── Create Post Form ───────────────────────────────────────────────────────

function CreatePostForm({ onPostCreated }: { onPostCreated: () => void }) {
    const [caption, setCaption] = useState('');
    const [platforms, setPlatforms] = useState<Platform[]>([]);
    const [mediaUrl, setMediaUrl] = useState('');
    const [mediaPreview, setMediaPreview] = useState<string | null>(null);
    const [mediaType, setMediaType] = useState<'photo' | 'video' | null>(null);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [dragging, setDragging] = useState(false);
    const [scheduleDate, setScheduleDate] = useState('');
    const [scheduleTime, setScheduleTime] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'partial'; message: string; details?: string[] } | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);

    const togglePlatform = (p: Platform) => {
        setPlatforms(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);
    };

    const uploadFile = async (file: File) => {
        setUploading(true);
        setUploadError(null);
        setMediaPreview(URL.createObjectURL(file));
        setMediaType(file.type.startsWith('video/') ? 'video' : 'photo');

        try {
            const formData = new FormData();
            formData.append('file', file);
            const res = await fetch('/api/upload', { method: 'POST', body: formData });
            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || 'Upload failed');
            }

            setMediaUrl(data.url);
        } catch (err: any) {
            setUploadError(err.message || 'Upload failed');
            setMediaPreview(null);
            setMediaType(null);
        } finally {
            setUploading(false);
        }
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            uploadFile(e.target.files[0]);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            uploadFile(e.dataTransfer.files[0]);
        }
    };

    const clearMedia = () => {
        if (mediaPreview) URL.revokeObjectURL(mediaPreview);
        setMediaUrl('');
        setMediaPreview(null);
        setMediaType(null);
        setUploadError(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleCreate = async () => {
        if (!caption || platforms.length === 0) return;
        setSubmitting(true);
        setFeedback(null);

        try {
            let scheduledFor = undefined;
            if (scheduleDate && scheduleTime) {
                scheduledFor = new Date(`${scheduleDate}T${scheduleTime}`).toISOString();
            }

            const res = await fetch('/api/content/publish', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    platforms,
                    caption,
                    mediaUrls: mediaUrl ? [mediaUrl] : [],
                    scheduledFor
                })
            });

            const data = await res.json();

            if (res.ok) {
                const post = data.post;
                const results = data.results || [];

                if (post.status === 'PUBLISHED') {
                    setFeedback({
                        type: 'success',
                        message: `✅ Published to ${platforms.join(' & ')}!`,
                        details: results.filter((r: any) => r.success).map((r: any) => `${r.platform}: Post ID ${r.postId}`),
                    });
                    setCaption(''); setPlatforms([]); clearMedia(); setScheduleDate(''); setScheduleTime('');
                } else if (post.status === 'PARTIAL') {
                    const successes = results.filter((r: any) => r.success);
                    const failures = results.filter((r: any) => !r.success);
                    setFeedback({
                        type: 'partial',
                        message: `⚠️ Partially published (${successes.length}/${results.length} platforms)`,
                        details: [
                            ...successes.map((r: any) => `✅ ${r.platform}: Published`),
                            ...failures.map((r: any) => `❌ ${r.platform}: ${r.error}`),
                        ],
                    });
                } else if (post.status === 'SCHEDULED') {
                    setFeedback({
                        type: 'success',
                        message: `📅 Scheduled for ${format(new Date(scheduledFor!), 'MMM d, h:mm a')}`,
                    });
                    setCaption(''); setPlatforms([]); clearMedia(); setScheduleDate(''); setScheduleTime('');
                } else {
                    const errors = results.filter((r: any) => !r.success);
                    setFeedback({
                        type: 'error',
                        message: '❌ Publishing failed',
                        details: errors.map((r: any) => `${r.platform}: ${r.error}`),
                    });
                }

                onPostCreated();
            } else {
                setFeedback({ type: 'error', message: data.error || 'Something went wrong' });
            }
        } catch (e: any) {
            setFeedback({ type: 'error', message: e.message || 'Network error' });
        } finally {
            setSubmitting(false);
        }
    };

    const inputStyle: React.CSSProperties = {
        background: 'rgba(255,255,255,0.05)', border: 'none', borderRadius: '12px',
        padding: '14px 20px', color: 'rgba(255,255,255,0.9)', fontSize: '0.9375rem',
        outline: 'none', width: '100%', fontWeight: 300, transition: 'background 0.3s',
    };

    const feedbackColors = {
        success: { bg: 'rgba(34,197,94,0.08)', border: 'rgba(34,197,94,0.2)', color: '#22c55e', icon: CheckCircle },
        error: { bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.2)', color: '#ef4444', icon: XCircle },
        partial: { bg: 'rgba(234,179,8,0.08)', border: 'rgba(234,179,8,0.2)', color: '#eab308', icon: AlertTriangle },
    };

    return (
        <div className="section-card" style={{ padding: '32px', maxWidth: '900px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

                {/* Feedback Banner */}
                {feedback && (() => {
                    const fb = feedbackColors[feedback.type];
                    const Icon = fb.icon;
                    return (
                        <div style={{
                            background: fb.bg, border: `1px solid ${fb.border}`, borderRadius: '12px',
                            padding: '16px 20px', display: 'flex', gap: '12px', alignItems: 'flex-start',
                        }}>
                            <Icon size={20} style={{ color: fb.color, flexShrink: 0, marginTop: '2px' }} />
                            <div style={{ flex: 1 }}>
                                <p style={{ color: fb.color, fontWeight: 600, fontSize: '0.9375rem', margin: 0 }}>{feedback.message}</p>
                                {feedback.details && feedback.details.length > 0 && (
                                    <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0 0' }}>
                                        {feedback.details.map((d, i) => (
                                            <li key={i} style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>{d}</li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                            <button onClick={() => setFeedback(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}>✕</button>
                        </div>
                    );
                })()}

                {/* Platform Selection */}
                <div>
                    <label style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--text-muted)', display: 'block', marginBottom: '12px' }}>Publish To</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                        {(['instagram', 'facebook', 'youtube'] as Platform[]).map((p) => {
                            const isSelected = platforms.includes(p);
                            const colors: Record<string, string> = { instagram: '#E1306C', facebook: '#1877F2', youtube: '#FF0000' };
                            const icons: Record<string, any> = { instagram: Instagram, facebook: Facebook, youtube: Youtube };
                            const Icon = icons[p];
                            const isYT = p === 'youtube';
                            return (
                                <button
                                    key={p}
                                    onClick={() => !isYT && togglePlatform(p)}
                                    style={{
                                        padding: '10px 20px', borderRadius: '10px', border: 'none', cursor: isYT ? 'not-allowed' : 'pointer',
                                        fontSize: '0.875rem', textTransform: 'capitalize', fontWeight: isSelected ? 600 : 400,
                                        display: 'flex', alignItems: 'center', gap: '8px',
                                        background: isSelected ? `${colors[p]}20` : 'rgba(255,255,255,0.05)',
                                        color: isYT ? 'rgba(255,255,255,0.2)' : (isSelected ? colors[p] : 'var(--text-muted)'),
                                        transition: 'all 0.2s',
                                        opacity: isYT ? 0.5 : 1,
                                    }}
                                    title={isYT ? 'YouTube publishing requires YouTube Studio' : undefined}
                                >
                                    <Icon size={16} />
                                    {p}
                                    {isYT && <span style={{ fontSize: '0.6875rem', opacity: 0.6 }}>(Soon)</span>}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Caption */}
                <div>
                    <label style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--text-muted)', display: 'block', marginBottom: '12px' }}>Caption</label>
                    <textarea
                        value={caption}
                        onChange={e => setCaption(e.target.value)}
                        placeholder="Write something engaging..."
                        style={{ ...inputStyle, height: '120px', resize: 'none', lineHeight: 1.6 }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px' }}>
                        <span style={{ fontSize: '0.75rem', color: caption.length > 2200 ? '#ef4444' : 'var(--text-muted)' }}>{caption.length}/2,200</span>
                    </div>
                </div>

                {/* Media Upload */}
                <div>
                    <label style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--text-muted)', display: 'block', marginBottom: '12px' }}>
                        Photo or Video
                        {platforms.includes('instagram') && <span style={{ color: '#E1306C', marginLeft: '8px', fontSize: '0.75rem' }}>Required for Instagram</span>}
                    </label>

                    <input type="file" ref={fileInputRef} onChange={handleFileSelect} style={{ display: 'none' }} accept="image/*,video/*" />

                    {/* Uploaded preview */}
                    {mediaPreview && (
                        <div style={{ position: 'relative', marginBottom: '12px', display: 'inline-block' }}>
                            {mediaType === 'video' ? (
                                <video src={mediaPreview} controls style={{ maxHeight: '200px', maxWidth: '100%', borderRadius: '12px', border: '1px solid var(--border-color)' }} />
                            ) : (
                                <img src={mediaPreview} alt="Preview" style={{ maxHeight: '200px', maxWidth: '100%', borderRadius: '12px', border: '1px solid var(--border-color)', objectFit: 'cover' }} />
                            )}
                            {/* Upload status overlay */}
                            {uploading && (
                                <div style={{
                                    position: 'absolute', inset: 0, borderRadius: '12px',
                                    background: 'rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column',
                                    alignItems: 'center', justifyContent: 'center', gap: '8px',
                                }}>
                                    <Loader2 size={24} style={{ color: '#fff', animation: 'spin 0.8s linear infinite' }} />
                                    <span style={{ color: '#fff', fontSize: '0.8125rem', fontWeight: 500 }}>Uploading...</span>
                                </div>
                            )}
                            {/* Checkmark overlay when upload done */}
                            {!uploading && mediaUrl && (
                                <div style={{
                                    position: 'absolute', top: '8px', left: '8px',
                                    background: 'rgba(34,197,94,0.9)', borderRadius: '50%',
                                    width: '28px', height: '28px', display: 'flex',
                                    alignItems: 'center', justifyContent: 'center',
                                }}>
                                    <CheckCircle size={16} style={{ color: '#fff' }} />
                                </div>
                            )}
                            {/* Remove button */}
                            {!uploading && (
                                <button onClick={clearMedia} style={{
                                    position: 'absolute', top: '-8px', right: '-8px',
                                    width: '26px', height: '26px', borderRadius: '50%',
                                    background: '#ef4444', border: 'none', cursor: 'pointer',
                                    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}>
                                    <X size={14} />
                                </button>
                            )}
                        </div>
                    )}

                    {/* Upload error */}
                    {uploadError && (
                        <div style={{
                            background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
                            borderRadius: '10px', padding: '10px 14px', marginBottom: '12px',
                            display: 'flex', alignItems: 'center', gap: '8px',
                        }}>
                            <XCircle size={16} style={{ color: '#ef4444', flexShrink: 0 }} />
                            <span style={{ color: '#ef4444', fontSize: '0.8125rem' }}>{uploadError}</span>
                        </div>
                    )}

                    {/* Drop zone (shown when no media selected) */}
                    {!mediaPreview && (
                        <div
                            onClick={() => fileInputRef.current?.click()}
                            onDragOver={e => { e.preventDefault(); setDragging(true); }}
                            onDragLeave={() => setDragging(false)}
                            onDrop={handleDrop}
                            style={{
                                border: `2px dashed ${dragging ? 'var(--accent)' : 'rgba(255,255,255,0.1)'}`,
                                borderRadius: '14px', padding: '36px 24px', textAlign: 'center',
                                cursor: 'pointer', transition: 'all 0.2s',
                                background: dragging ? 'rgba(255,255,255,0.04)' : 'transparent',
                            }}
                        >
                            <Upload size={28} style={{ color: dragging ? 'var(--accent)' : 'var(--text-muted)', margin: '0 auto 10px', display: 'block', opacity: 0.6 }} />
                            <p style={{ margin: '0 0 4px', fontSize: '0.9375rem', color: dragging ? 'var(--accent)' : '#ccc', fontWeight: 500 }}>
                                Drag & drop or click to browse
                            </p>
                            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                Photos (JPG, PNG, WebP) or Videos (MP4, MOV) — up to 10MB / 100MB
                            </p>
                        </div>
                    )}
                </div>

                {/* Schedule */}
                <div>
                    <label style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--text-muted)', display: 'block', marginBottom: '12px' }}>Schedule (optional)</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                        <input type="date" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)} style={{ ...inputStyle, width: 'auto', colorScheme: 'dark' }} />
                        <input type="time" value={scheduleTime} onChange={e => setScheduleTime(e.target.value)} style={{ ...inputStyle, width: 'auto', colorScheme: 'dark' }} />
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '6px' }}>Leave blank to publish immediately.</p>
                </div>

                {/* Submit */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    <button
                        onClick={() => { setCaption(''); setPlatforms([]); clearMedia(); setScheduleDate(''); setScheduleTime(''); setFeedback(null); }}
                        style={{ padding: '10px 24px', borderRadius: '10px', border: 'none', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 500, background: 'transparent', color: 'var(--text-muted)' }}
                    >
                        Clear
                    </button>
                    <button
                        onClick={handleCreate}
                        disabled={!caption || platforms.length === 0 || submitting || uploading}
                        style={{
                            padding: '12px 28px', borderRadius: '10px', border: 'none', cursor: 'pointer',
                            fontSize: '0.9375rem', fontWeight: 600,
                            background: (!caption || platforms.length === 0 || uploading) ? 'rgba(255,255,255,0.05)' : 'var(--accent)',
                            color: (!caption || platforms.length === 0 || uploading) ? 'var(--text-muted)' : '#000',
                            display: 'flex', alignItems: 'center', gap: '8px',
                            opacity: submitting ? 0.7 : 1, transition: 'all 0.2s',
                        }}
                    >
                        {submitting ? (
                            <><Loader2 size={18} style={{ animation: 'spin 0.8s linear infinite' }} /> Publishing...</>
                        ) : (
                            <>{scheduleDate ? <Calendar size={18} /> : <Send size={18} />} {scheduleDate ? 'Schedule' : 'Publish Now'}</>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Post List ──────────────────────────────────────────────────────────────

function PostList({ posts, emptyMessage, onUpdate }: { posts: PostRecord[], emptyMessage: string, onUpdate?: () => void }) {
    const isScheduled = posts.length > 0 && posts[0]?.status === 'SCHEDULED';

    const handleDelete = async (id: string) => {
        try {
            await fetch(`/api/content/publish?id=${id}`, { method: 'DELETE' });
            onUpdate?.();
        } catch (e) {
            console.error(e);
        }
    };

    if (posts.length === 0) {
        return (
            <div className="section-card" style={{ padding: '60px 32px', textAlign: 'center' }}>
                <LayoutTemplate size={40} style={{ color: 'var(--text-muted)', margin: '0 auto 12px', opacity: 0.4 }} />
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9375rem' }}>{emptyMessage}</p>
            </div>
        );
    }

    const statusStyles: Record<string, { bg: string; color: string; label: string }> = {
        PUBLISHED: { bg: 'rgba(34,197,94,0.1)', color: '#22c55e', label: '● Live' },
        SCHEDULED: { bg: 'rgba(234,179,8,0.1)', color: '#eab308', label: '◷ Queued' },
        FAILED: { bg: 'rgba(239,68,68,0.1)', color: '#ef4444', label: '✕ Failed' },
        PARTIAL: { bg: 'rgba(234,179,8,0.1)', color: '#eab308', label: '⚠ Partial' },
        PUBLISHING: { bg: 'rgba(59,130,246,0.1)', color: '#3b82f6', label: '↻ Sending' },
        DRAFT: { bg: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)', label: '○ Draft' },
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {posts.map(post => {
                const st = statusStyles[post.status] || statusStyles.DRAFT;
                return (
                    <div key={post.id} className="section-card" style={{ padding: '20px 24px', display: 'flex', alignItems: 'center', gap: '16px' }}>
                        {/* Status Dot */}
                        <span style={{ padding: '4px 10px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600, background: st.bg, color: st.color, whiteSpace: 'nowrap' }}>
                            {st.label}
                        </span>

                        {/* Platforms */}
                        <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                            {post.platforms.map(p => {
                                const colors: Record<string, string> = { instagram: '#E1306C', facebook: '#1877F2', youtube: '#FF0000' };
                                const Icon = p === 'instagram' ? Instagram : p === 'facebook' ? Facebook : Youtube;
                                return <Icon key={p} size={14} style={{ color: colors[p] }} />;
                            })}
                        </div>

                        {/* Caption */}
                        <p style={{ flex: 1, margin: 0, fontSize: '0.875rem', color: '#ddd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {post.caption}
                        </p>

                        {/* Date */}
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                            {post.publishedAt
                                ? format(new Date(post.publishedAt), 'MMM d, h:mm a')
                                : post.scheduledFor
                                    ? format(new Date(post.scheduledFor), 'MMM d, h:mm a')
                                    : format(new Date(post.createdAt), 'MMM d')}
                        </span>

                        {/* Errors */}
                        {post.errors && Object.keys(post.errors).length > 0 && (
                            <span title={Object.entries(post.errors).map(([k, v]) => `${k}: ${v}`).join('\n')} style={{ cursor: 'help' }}>
                                <AlertTriangle size={14} style={{ color: '#ef4444' }} />
                            </span>
                        )}

                        {/* Delete for scheduled */}
                        {isScheduled && onUpdate && (
                            <button onClick={() => handleDelete(post.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(239,68,68,0.7)', fontSize: '0.75rem', fontWeight: 600 }}>
                                Cancel
                            </button>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

// ─── Goals Scorecard (Redesigned — TLDR / Action-Based) ─────────────────────

function GoalsScorecard({ goals }: { goals: GoalsData | null }) {
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

    // Determine "What to do today" actions
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
    const statusLabel = isComplete ? 'All Done! 🎉' : progress >= 50 ? 'On Track' : 'Behind';

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '700px' }}>

            {/* TLDR Header */}
            <div className="section-card" style={{ padding: '28px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
                    <div>
                        <h3 style={{ margin: '0 0 4px 0', fontSize: '1.125rem' }}>
                            This Week's Content Goals
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
                    const colors: Record<string, string> = { instagram: '#E1306C', facebook: '#1877F2', youtube: '#FF0000' };
                    const icons: Record<string, any> = { instagram: Instagram, facebook: Facebook, youtube: Youtube };
                    const Icon = icons[key] || Target;
                    const pct = val.target > 0 ? Math.min((val.current / val.target) * 100, 100) : 0;
                    const done = val.current >= val.target;

                    return (
                        <div key={key} className="section-card" style={{ padding: '20px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                                <Icon size={16} style={{ color: colors[key] || 'var(--text-muted)' }} />
                                <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#ccc', textTransform: 'capitalize' }}>{val.label}</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px', marginBottom: '10px' }}>
                                <span style={{ fontSize: '1.5rem', fontWeight: 700, color: done ? '#22c55e' : '#fff' }}>{val.current}</span>
                                <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>/ {val.target}</span>
                            </div>
                            <div style={{ height: '4px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px', overflow: 'hidden' }}>
                                <div style={{ width: `${pct}%`, height: '100%', borderRadius: '2px', background: done ? '#22c55e' : (colors[key] || 'var(--accent)'), transition: 'width 0.5s ease' }} />
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
                        Great work this week! Keep the momentum going. 🚀
                    </p>
                </div>
            )}
        </div>
    );
}
