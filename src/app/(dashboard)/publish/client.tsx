'use client';

import { useState, useEffect, useRef } from 'react';
import { PostRecord, Platform } from '@/lib/content-publisher';
import { WeeklyAccountability } from '@/lib/posting-goals';
import {
    Calendar, CheckCircle, Clock, History, PenTool, LayoutTemplate,
    Instagram, Facebook, Youtube, PlaySquare, Plus, Send, Activity, Loader2, Image as ImageIcon, Flame, Target
} from 'lucide-react';
import { format } from 'date-fns';

export default function PublishDashboardClient() {
    const [activeTab, setActiveTab] = useState<'create' | 'scheduled' | 'history' | 'goals'>('create');
    const [posts, setPosts] = useState<PostRecord[]>([]);
    const [goals, setGoals] = useState<WeeklyAccountability | null>(null);
    const [heatmap, setHeatmap] = useState<Record<string, number>>({});
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
            if (gData.heatmap) setHeatmap(gData.heatmap);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const scheduled = posts.filter(p => p.status === 'SCHEDULED');
    const history = posts.filter(p => p.status !== 'SCHEDULED');

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 pb-20">


            {/* Nav Tabs */}
            <div className="flex flex-wrap gap-1 bg-slate-900/50 p-1.5 rounded-2xl inline-flex backdrop-blur-md shadow-sm">
                <TabButton
                    active={activeTab === 'create'}
                    onClick={() => setActiveTab('create')}
                    icon={PenTool} label="Craft Post"
                />
                <TabButton
                    active={activeTab === 'scheduled'}
                    onClick={() => setActiveTab('scheduled')}
                    icon={Clock} label={`Queue (${scheduled.length})`}
                />
                <TabButton
                    active={activeTab === 'history'}
                    onClick={() => setActiveTab('history')}
                    icon={History} label="History"
                />
                <TabButton
                    active={activeTab === 'goals'}
                    onClick={() => setActiveTab('goals')}
                    icon={Activity} label="Goals & Streaks"
                />
            </div>

            {/* Main Content Area */}
            <div className="relative min-h-[500px]">
                {loading && (
                    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#0B1121]/50 backdrop-blur-md rounded-3xl transition-all">
                        <Loader2 className="w-8 h-8 animate-spin text-[var(--accent)] mb-4" />
                        <p className="text-slate-400 font-light">Syncing workspace...</p>
                    </div>
                )}

                {activeTab === 'create' && <CreatePostForm onPostCreated={fetchData} />}
                {activeTab === 'scheduled' && <PostList posts={scheduled} emptyMessage="Your schedule is clear. Nothing waiting in queue." onUpdate={fetchData} />}
                {activeTab === 'history' && <PostList posts={history} emptyMessage="No publishing history available yet." />}
                {activeTab === 'goals' && goals && <GoalsScorecard goals={goals} heatmap={heatmap} />}
            </div>
        </div>
    );
}

// ----------------------------------------------------------------------------
// HELPER COMPONENTS
// ----------------------------------------------------------------------------

function TabButton({ active, onClick, icon: Icon, label }: any) {
    return (
        <button
            onClick={onClick}
            className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-300 flex items-center gap-2.5 ${active
                ? 'bg-white/10 text-white shadow-sm scale-[1.02]'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
        >
            <Icon size={16} className={active ? 'text-[var(--accent)]' : 'opacity-70'} />
            <span className="tracking-wide">{label}</span>
        </button>
    );
}

function CreatePostForm({ onPostCreated }: { onPostCreated: () => void }) {
    const [caption, setCaption] = useState('');
    const [platforms, setPlatforms] = useState<Platform[]>([]);
    const [mediaUrl, setMediaUrl] = useState('');
    const [mediaPreview, setMediaPreview] = useState<string | null>(null);
    const [mediaFile, setMediaFile] = useState<File | null>(null);
    const [scheduleDate, setScheduleDate] = useState('');
    const [scheduleTime, setScheduleTime] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);

    const togglePlatform = (p: Platform) => {
        setPlatforms(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            setMediaFile(file);
            setMediaUrl(file.name);
            // Create visual preview
            const previewUrl = URL.createObjectURL(file);
            setMediaPreview(previewUrl);
        }
    };

    const clearMedia = () => {
        if (mediaPreview) URL.revokeObjectURL(mediaPreview);
        setMediaFile(null);
        setMediaUrl('');
        setMediaPreview(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleCreate = async () => {
        if (!caption || platforms.length === 0) return;
        setSubmitting(true);
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
            if (res.ok) {
                setCaption('');
                setPlatforms([]);
                clearMedia();
                setScheduleDate('');
                setScheduleTime('');
                onPostCreated();
            }
        } catch (e) {
            console.error(e);
        } finally {
            setSubmitting(false);
        }
    };

    const inputStyle: React.CSSProperties = {
        background: 'rgba(255,255,255,0.05)', border: 'none', borderRadius: '12px',
        padding: '14px 20px', color: 'rgba(255,255,255,0.9)', fontSize: '0.9375rem',
        outline: 'none', width: '100%', fontWeight: 300, transition: 'background 0.3s',
    };

    return (
        <div className="section-card" style={{ padding: '32px', maxWidth: '900px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>

                {/* Platform Selection */}
                <div>
                    <label style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--text-muted)', display: 'block', marginBottom: '12px' }}>Select Destinations</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                        {['instagram', 'facebook', 'youtube'].map((p) => {
                            const isSelected = platforms.includes(p as Platform);
                            const colors: Record<string, string> = { instagram: '#E1306C', facebook: '#1877F2', youtube: '#FF0000' };
                            return (
                                <button
                                    key={p}
                                    onClick={() => togglePlatform(p as Platform)}
                                    style={{
                                        padding: '10px 20px', borderRadius: '10px', border: 'none', cursor: 'pointer',
                                        fontSize: '0.875rem', textTransform: 'capitalize', fontWeight: isSelected ? 600 : 400,
                                        display: 'flex', alignItems: 'center', gap: '8px',
                                        background: isSelected ? `${colors[p]}20` : 'rgba(255,255,255,0.05)',
                                        color: isSelected ? colors[p] : 'var(--text-muted)',
                                        transition: 'all 0.2s',
                                        boxShadow: isSelected ? `0 0 12px ${colors[p]}15` : 'none',
                                    }}
                                >
                                    {p === 'instagram' && <Instagram size={16} />}
                                    {p === 'facebook' && <Facebook size={16} />}
                                    {p === 'youtube' && <Youtube size={16} />}
                                    {p}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Caption Input */}
                <div>
                    <label style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--text-muted)', display: 'block', marginBottom: '12px' }}>Caption</label>
                    <textarea
                        value={caption}
                        onChange={e => setCaption(e.target.value)}
                        placeholder="Write something engaging..."
                        style={{ ...inputStyle, height: '120px', resize: 'none', lineHeight: 1.6 }}
                    />
                </div>

                {/* Media Input */}
                <div>
                    <label style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--text-muted)', display: 'block', marginBottom: '12px' }}>Visual Assets</label>

                    {/* Image Preview */}
                    {mediaPreview && (
                        <div style={{ position: 'relative', marginBottom: '12px', display: 'inline-block' }}>
                            <img
                                src={mediaPreview}
                                alt="Upload preview"
                                style={{
                                    maxHeight: '200px', maxWidth: '100%', borderRadius: '12px',
                                    border: '1px solid var(--border-color)', objectFit: 'cover',
                                }}
                            />
                            <button
                                onClick={clearMedia}
                                style={{
                                    position: 'absolute', top: '-8px', right: '-8px',
                                    width: '24px', height: '24px', borderRadius: '50%',
                                    background: '#ef4444', border: 'none', cursor: 'pointer',
                                    color: '#fff', fontSize: '14px', fontWeight: 700,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}
                            >
                                ✕
                            </button>
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: '10px' }}>
                        <div style={{ ...inputStyle, flex: 1, display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px' }}>
                            <ImageIcon size={18} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                            <input
                                type="text"
                                value={mediaUrl}
                                onChange={e => { setMediaUrl(e.target.value); setMediaPreview(null); }}
                                placeholder="Paste media URL or select a file →"
                                style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.9)', outline: 'none', width: '100%', fontWeight: 300 }}
                            />
                        </div>
                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleFileSelect}
                            style={{ display: 'none' }}
                            accept="image/*,video/*"
                        />
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            style={{
                                padding: '12px 20px', borderRadius: '12px', border: 'none', cursor: 'pointer',
                                background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)',
                                display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8125rem',
                                fontWeight: 500, whiteSpace: 'nowrap', transition: 'all 0.2s',
                            }}
                        >
                            <Plus size={16} /> Browse
                        </button>
                    </div>
                </div>

                {/* Scheduling */}
                <div>
                    <label style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--text-muted)', display: 'block', marginBottom: '12px' }}>Publish Timing</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                        <input
                            type="date"
                            value={scheduleDate}
                            onChange={e => setScheduleDate(e.target.value)}
                            style={{ ...inputStyle, width: 'auto', colorScheme: 'dark' }}
                        />
                        <input
                            type="time"
                            value={scheduleTime}
                            onChange={e => setScheduleTime(e.target.value)}
                            style={{ ...inputStyle, width: 'auto', colorScheme: 'dark' }}
                        />
                    </div>
                    <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '8px' }}>Leave blank to post immediately.</p>
                </div>

                {/* Submit */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', paddingTop: '20px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    <button
                        onClick={() => { setCaption(''); setPlatforms([]); clearMedia(); setScheduleDate(''); setScheduleTime(''); }}
                        style={{
                            padding: '10px 24px', borderRadius: '10px', border: 'none', cursor: 'pointer',
                            fontSize: '0.8125rem', fontWeight: 500, background: 'transparent',
                            color: 'var(--text-muted)', transition: 'color 0.2s',
                        }}
                    >
                        Clear Fields
                    </button>
                    <button
                        onClick={handleCreate}
                        disabled={!caption || platforms.length === 0 || submitting}
                        style={{
                            padding: '12px 28px', borderRadius: '10px', border: 'none', cursor: 'pointer',
                            fontSize: '0.9375rem', fontWeight: 600,
                            background: (!caption || platforms.length === 0) ? 'rgba(255,255,255,0.05)' : 'var(--accent)',
                            color: (!caption || platforms.length === 0) ? 'var(--text-muted)' : '#000',
                            display: 'flex', alignItems: 'center', gap: '8px',
                            transition: 'all 0.2s',
                            opacity: submitting ? 0.7 : 1,
                        }}
                    >
                        {submitting ? (
                            <>
                                <Loader2 size={18} style={{ animation: 'spin 0.8s linear infinite' }} />
                                Processing
                            </>
                        ) : (
                            <>
                                {scheduleDate ? <Calendar size={18} /> : <Send size={18} />}
                                {scheduleDate ? 'Schedule' : 'Post'}
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}

function PostList({ posts, emptyMessage, onUpdate }: { posts: PostRecord[], emptyMessage: string, onUpdate?: () => void }) {
    if (posts.length === 0) return (
        <div className="py-32 flex flex-col items-center justify-center text-center rounded-3xl bg-slate-900/30 backdrop-blur-sm">
            <LayoutTemplate className="w-16 h-16 text-slate-700 mb-6 stroke-[1]" />
            <h3 className="text-xl font-serif tracking-wide text-slate-300">Nothing to display</h3>
            <p className="text-slate-500 font-light mt-3">{emptyMessage}</p>
        </div>
    );

    const handleDelete = async (id: string) => {
        if (!onUpdate) return;
        if (confirm('Are you sure you want to cancel this scheduled post?')) {
            await fetch(`/api/content/publish?id=${id}`, { method: 'DELETE' });
            onUpdate();
        }
    };

    return (
        <div className="flex flex-col gap-6">
            {posts.map(post => {
                const isScheduled = post.status === 'SCHEDULED';
                const isPublished = post.status === 'PUBLISHED';

                return (
                    <div key={post.id} className="group relative bg-slate-900/40 rounded-3xl p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-8 overflow-hidden transition-all duration-500 hover:bg-slate-900/60 hover:shadow-2xl hover:-translate-y-1">

                        {/* Dimensional Glow */}
                        <div className="absolute -inset-1 bg-gradient-to-r from-white/0 via-white/5 to-white/0 opacity-0 group-hover:opacity-100 transition-opacity duration-1000 blur-md pointer-events-none"></div>

                        <div className="flex flex-col gap-5 flex-grow max-w-3xl relative z-10">
                            {/* Badges Row */}
                            <div className="flex flex-wrap items-center gap-3">
                                {post.platforms.map(p => (
                                    <span key={p} className="bg-white/5 text-slate-300 px-4 py-1.5 rounded-full text-[11px] capitalize tracking-widest font-semibold shadow-sm overflow-hidden relative">
                                        <span className="relative z-10">{p}</span>
                                    </span>
                                ))}
                                <span className={`px-4 py-1.5 rounded-full text-[11px] uppercase tracking-widest font-bold shadow-sm 
                                    ${isPublished ? 'text-green-400 bg-green-500/10' :
                                        isScheduled ? 'text-yellow-400 bg-yellow-500/10' :
                                            'text-red-400 bg-red-500/10'
                                    }`}>
                                    {post.status}
                                </span>
                            </div>

                            {/* Copy */}
                            <p className="text-white/80 whitespace-pre-wrap text-[16px] leading-relaxed font-light group-hover:text-white transition-colors duration-500">
                                {post.caption}
                            </p>

                            {/* Metadata */}
                            <div className="text-[13px] text-slate-500 flex flex-wrap items-center gap-x-8 gap-y-3 font-medium tracking-wide">
                                <span><span className="text-slate-600 font-light">Created:</span> {format(new Date(post.createdAt), 'MMM d, yyyy')}</span>
                                {post.scheduledFor && (
                                    <span className="text-yellow-500/90 flex items-center gap-2 bg-yellow-500/5 px-3 py-1 rounded-lg">
                                        <Clock size={14} strokeWidth={2.5} />
                                        Scheduled for {format(new Date(post.scheduledFor), 'MMM d, h:mm a')}
                                    </span>
                                )}
                                {post.publishedAt && (
                                    <span className="text-green-500/90 flex items-center gap-2">
                                        <CheckCircle size={14} strokeWidth={2.5} />
                                        Live since {format(new Date(post.publishedAt), 'MMM d, yyyy')}
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Media Thumbnail */}
                        <div className="flex items-center gap-6 shrink-0 w-full md:w-auto mt-6 md:mt-0 relative z-10">
                            {post.mediaUrls[0] ? (
                                <div className="w-28 h-28 rounded-2xl bg-black/40 overflow-hidden shadow-inner group-hover:shadow-[0_0_20px_rgba(255,255,255,0.05)] transition-shadow duration-500">
                                    <img src={post.mediaUrls[0]} alt="Media" className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-all duration-700 group-hover:scale-105" />
                                </div>
                            ) : (
                                <div className="w-28 h-28 rounded-2xl bg-white/5 flex items-center justify-center shadow-inner">
                                    <div className="text-center opacity-50">
                                        <LayoutTemplate className="w-8 h-8 text-slate-500 mx-auto mb-2 stroke-[1]" />
                                        <span className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">Text Only</span>
                                    </div>
                                </div>
                            )}

                            {isScheduled && onUpdate && (
                                <button
                                    onClick={() => handleDelete(post.id)}
                                    className="px-5 py-2.5 text-red-400/80 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-all duration-300 text-sm font-semibold tracking-wide"
                                >
                                    Cancel
                                </button>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function GoalsScorecard({ goals, heatmap }: { goals: WeeklyAccountability, heatmap: Record<string, number> }) {
    return (
        <div className="flex flex-col gap-8 animate-in fade-in slide-in-from-bottom-4 duration-700 max-w-4xl">

            {/* Header Context */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between bg-slate-900/40 p-8 rounded-3xl relative">
                <div>
                    <h3 className="text-2xl font-serif tracking-wide mb-2 flex items-center gap-3 text-white">
                        <Flame className="text-[var(--accent)] fill-[var(--accent)]/20" size={28} strokeWidth={1.5} />
                        {goals.currentStreak} Week Streak
                    </h3>
                    <p className="text-slate-400 font-light">Check off your tasks below to maintain momentum.</p>
                </div>
                <div className="mt-6 sm:mt-0 flex flex-col items-end">
                    <span className="text-xs uppercase tracking-widest font-bold text-[var(--accent)] mb-1">Status</span>
                    <span className="text-sm font-medium text-white/90 bg-white/5 px-4 py-2 rounded-xl">Action Required</span>
                </div>
            </div>

            {/* Accountability Tracker */}
            <div className="bg-slate-900/40 p-8 rounded-3xl relative">
                <h3 className="text-xl font-serif mb-6 flex items-center gap-3 tracking-wide text-white border-b border-white/5 pb-4">
                    <Target className="text-[var(--accent)]" size={20} strokeWidth={2} />
                    Weekly Accountability Tracker
                </h3>

                <div className="flex flex-col gap-3 relative z-10">
                    {goals.goals.map((g, i) => {
                        const done = g.currentCount >= g.targetCount;
                        return (
                            <div
                                key={g.id}
                                className={`flex items-center justify-between p-4 rounded-xl transition-all duration-300 border mb-2 ${done ? 'bg-green-500/5 border-green-500/20' : 'bg-white/5 border-white/5 hover:border-white/20 hover:bg-white/10'
                                    }`}
                                style={{ animationDelay: `${i * 100}ms` }}
                            >
                                <div className="flex items-center gap-4">
                                    <div className={`w-6 h-6 shrink-0 rounded-full border-2 flex items-center justify-center transition-all duration-300 ${done ? 'bg-green-500 border-green-500 text-black' : 'border-slate-500 text-transparent hover:border-[var(--accent)]'
                                        }`}>
                                        <CheckCircle size={14} strokeWidth={3} className={done ? 'opacity-100' : 'opacity-0 hover:opacity-100 text-[var(--accent)]'} />
                                    </div>
                                    <div>
                                        <p className={`text-base font-medium tracking-wide capitalize ${done ? 'text-slate-400 line-through' : 'text-slate-200'}`}>
                                            Post {g.targetCount} {g.mediaType !== 'any' ? g.mediaType : 'Content Piece'}{g.targetCount > 1 ? 's' : ''} on {g.platform}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center text-sm font-medium tracking-wider">
                                    <span className={done ? 'text-green-400' : 'text-slate-300'}>{g.currentCount}</span>
                                    <span className="text-slate-600 mx-1">/</span>
                                    <span className="text-slate-500">{g.targetCount} completed</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

