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
    const [scheduleDate, setScheduleDate] = useState('');
    const [scheduleTime, setScheduleTime] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);

    const togglePlatform = (p: Platform) => {
        setPlatforms(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setMediaUrl(e.target.files[0].name);
        }
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
                setMediaUrl('');
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

    return (
        <div className="bg-slate-900/40 p-10 rounded-3xl max-w-4xl relative overflow-hidden group shadow-xl">
            {/* Subtle glow effect behind form */}
            <div className="absolute top-0 right-0 w-96 h-96 bg-[var(--accent)]/5 rounded-full blur-[100px] pointer-events-none transition-opacity duration-700 opacity-50 group-hover:opacity-100"></div>

            <div className="relative z-10 flex flex-col gap-10">

                {/* Platform Selection */}
                <div>
                    <label className="text-sm font-medium text-slate-400 block mb-4 tracking-wide">Select Destinations</label>
                    <div className="flex flex-wrap gap-4">
                        {['instagram', 'facebook', 'youtube'].map((p) => {
                            const isSelected = platforms.includes(p as Platform);
                            return (
                                <button
                                    key={p}
                                    onClick={() => togglePlatform(p as Platform)}
                                    className={`relative px-6 py-3.5 rounded-2xl text-sm capitalize flex items-center gap-2.5 transition-all duration-300 overflow-hidden outline-none ${isSelected
                                        ? 'text-white shadow-lg scale-105'
                                        : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10'
                                        }`}
                                >
                                    {isSelected && <div className="absolute inset-0 bg-gradient-to-r from-[var(--accent)]/90 to-[#B89615]/90 opacity-25"></div>}
                                    {isSelected && <div className="absolute inset-0 bg-[var(--accent)]/10 mix-blend-overlay"></div>}

                                    <span className="relative z-10 flex items-center gap-2.5 font-medium tracking-wide">
                                        {p === 'instagram' && <Instagram size={18} className={isSelected ? 'text-[#E1306C]' : ''} />}
                                        {p === 'facebook' && <Facebook size={18} className={isSelected ? 'text-[#1877F2]' : ''} />}
                                        {p === 'youtube' && <Youtube size={18} className={isSelected ? 'text-[#FF0000]' : ''} />}
                                        {p}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Caption Input */}
                <div>
                    <label className="text-sm font-medium text-slate-400 block mb-4 tracking-wide">Caption</label>
                    <textarea
                        value={caption}
                        onChange={e => setCaption(e.target.value)}
                        placeholder="Write something engaging..."
                        className="w-full h-36 bg-white/5 rounded-2xl p-6 text-white/90 placeholder-slate-600 focus:outline-none focus:bg-white/10 transition-all duration-300 resize-none border-none ring-0 shadow-inner font-light leading-relaxed text-lg"
                    />
                </div>

                {/* Media Input */}
                <div>
                    <label className="text-sm font-medium text-slate-400 block mb-4 tracking-wide">Visual Assets</label>
                    <div className="flex flex-col sm:flex-row gap-4">
                        <div className="flex-grow flex items-center bg-white/5 rounded-2xl px-6 py-4 transition-all duration-300 focus-within:bg-white/10 shadow-inner">
                            <ImageIcon size={20} className="text-slate-500 mr-4" strokeWidth={1.5} />
                            <input
                                type="text"
                                value={mediaUrl}
                                onChange={e => setMediaUrl(e.target.value)}
                                placeholder="Media URL or select file"
                                className="bg-transparent border-none text-white/90 placeholder-slate-600 focus:outline-none w-full font-light"
                            />
                        </div>
                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleFileSelect}
                            className="hidden"
                            accept="image/*,video/*"
                        />
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="px-8 py-4 rounded-2xl bg-white/5 text-slate-300 hover:text-white hover:bg-white/10 transition-all duration-300 flex items-center gap-2 whitespace-nowrap shadow-sm font-medium tracking-wide"
                        >
                            <Plus size={18} /> Browse Files
                        </button>
                    </div>
                </div>

                {/* Scheduling */}
                <div>
                    <label className="text-sm font-medium text-slate-400 block mb-4 tracking-wide">Publish Timing</label>
                    <div className="flex flex-wrap gap-4">
                        <div className="relative group">
                            <input
                                type="date"
                                value={scheduleDate}
                                onChange={e => setScheduleDate(e.target.value)}
                                className="bg-white/5 rounded-2xl px-6 py-4 text-white/90 focus:outline-none focus:bg-white/10 transition-all duration-300 border-none shadow-inner [color-scheme:dark] font-light"
                            />
                        </div>
                        <div className="relative group">
                            <input
                                type="time"
                                value={scheduleTime}
                                onChange={e => setScheduleTime(e.target.value)}
                                className="bg-white/5 rounded-2xl px-6 py-4 text-white/90 focus:outline-none focus:bg-white/10 transition-all duration-300 border-none shadow-inner [color-scheme:dark] font-light"
                            />
                        </div>
                    </div>
                    <p className="text-sm text-slate-500 mt-4 font-light">Leave blank to post immediately to selected platforms.</p>
                </div>

                {/* Submit Action */}
                <div className="pt-8 flex justify-end gap-4 border-t border-white/5">
                    <button
                        onClick={() => {
                            setCaption(''); setPlatforms([]); setMediaUrl(''); setScheduleDate(''); setScheduleTime('');
                        }}
                        className="px-8 py-4 rounded-2xl text-sm font-medium tracking-wide text-slate-500 hover:text-white hover:bg-white/5 transition-all duration-300"
                    >
                        Clear Fields
                    </button>
                    <button
                        onClick={handleCreate}
                        disabled={!caption || platforms.length === 0 || submitting}
                        className="bg-[var(--accent)] text-black font-semibold px-10 py-4 rounded-2xl disabled:bg-slate-800 disabled:text-slate-500 disabled:shadow-none disabled:cursor-not-allowed hover:bg-[#D8B41D]/90 hover:shadow-[0_0_20px_rgba(216,180,29,0.3)] hover:-translate-y-1 transition-all duration-300 flex items-center gap-3 tracking-wide text-lg"
                    >
                        {submitting ? (
                            <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                Processing
                            </>
                        ) : (
                            <>
                                {scheduleDate ? <Calendar size={20} /> : <Send size={20} />}
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

