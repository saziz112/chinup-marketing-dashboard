'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { upload } from '@vercel/blob/client';
import { PostRecord, Platform } from '@/lib/content-publisher';
import { PostType } from '@/lib/integrations/meta-publisher';
import { USERS } from '@/lib/config';
import {
    Calendar, CheckCircle, Clock, History, PenTool, LayoutTemplate,
    Instagram, Facebook, Youtube, Send, Loader2, MapPin,
    Image as ImageIcon, Target, AlertTriangle, XCircle, Zap,
    Upload, Film, X, Edit3, Sparkles, FileText, ChevronDown, ChevronUp,
    ChevronLeft, ChevronRight, Plus,
    Archive, Eye, User
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

// ─── Types ──────────────────────────────────────────────────────────────────

interface GoalsData {
    weekStarting: string;
    weekEnding: string;
    targets: Record<string, { target: number; current: number; label: string }>;
    currentStreak: number;
    isOnTrack: boolean;
}

function resolveDisplayName(email?: string): string {
    if (!email) return 'Unknown';
    const user = USERS.find(u => u.email === email);
    return user?.displayName || email.split('@')[0];
}

const platformMeta: Record<string, { color: string; icon: any; label: string }> = {
    instagram: { color: '#E1306C', icon: Instagram, label: 'Instagram' },
    facebook: { color: '#1877F2', icon: Facebook, label: 'Facebook' },
    'google-business': { color: '#4285F4', icon: MapPin, label: 'Google Business' },
    youtube: { color: '#FF0000', icon: Youtube, label: 'YouTube' },
};

// ─── Main Component ─────────────────────────────────────────────────────────

export default function PublishDashboardClient() {
    const [activeTab, setActiveTab] = useState<'create' | 'scheduled' | 'history' | 'goals'>('create');
    const [posts, setPosts] = useState<PostRecord[]>([]);
    const [goals, setGoals] = useState<GoalsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [showArchived, setShowArchived] = useState(false);
    const [editingPost, setEditingPost] = useState<PostRecord | null>(null);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [postsRes, goalsRes] = await Promise.all([
                fetch(`/api/content/publish?type=posts${showArchived ? '&includeArchived=true' : ''}`),
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
    }, [showArchived]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const scheduled = posts.filter(p => p.status === 'SCHEDULED');
    const history = posts.filter(p => p.status !== 'SCHEDULED' && p.status !== 'DRAFT');

    const handleEditPost = (post: PostRecord) => {
        setEditingPost(post);
        setActiveTab('create');
    };

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
                <button onClick={() => { setActiveTab('create'); setEditingPost(null); }} style={tabStyle(activeTab === 'create')}>
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

                {activeTab === 'create' && (
                    <CreatePostForm
                        onPostCreated={() => { fetchData(); setEditingPost(null); }}
                        editingPost={editingPost}
                        onCancelEdit={() => setEditingPost(null)}
                    />
                )}
                {activeTab === 'scheduled' && (
                    <QueueCalendar posts={scheduled} onUpdate={fetchData} onEdit={handleEditPost} />
                )}
                {activeTab === 'history' && (
                    <HistoryList
                        posts={history}
                        showArchived={showArchived}
                        onToggleArchived={() => setShowArchived(v => !v)}
                    />
                )}
                {activeTab === 'goals' && <GoalsScorecard goals={goals} />}
            </div>
        </div>
    );
}

// ─── Create Post Form ───────────────────────────────────────────────────────

function CreatePostForm({ onPostCreated, editingPost, onCancelEdit }: {
    onPostCreated: () => void;
    editingPost: PostRecord | null;
    onCancelEdit: () => void;
}) {
    const searchParams = useSearchParams();
    const [caption, setCaption] = useState('');
    const [platforms, setPlatforms] = useState<Platform[]>([]);
    const [postType, setPostType] = useState<PostType>('feed');
    const [mediaUrls, setMediaUrls] = useState<string[]>([]);
    const [mediaPreviews, setMediaPreviews] = useState<string[]>([]);
    const [mediaType, setMediaType] = useState<'photo' | 'video' | null>(null);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [dragging, setDragging] = useState(false);
    const [scheduleDate, setScheduleDate] = useState('');
    const [scheduleTime, setScheduleTime] = useState('');
    const [scheduleError, setScheduleError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'partial'; message: string; details?: string[] } | null>(null);
    const [gbpLocations, setGbpLocations] = useState<string[]>(['decatur', 'smyrna', 'kennesaw']);
    const [bulkMode, setBulkMode] = useState(false);
    const [csvText, setCsvText] = useState('');
    const [csvPreview, setCsvPreview] = useState<any>(null);
    const [csvLoading, setCsvLoading] = useState(false);
    const [aiLoading, setAiLoading] = useState(false);
    const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);

    // Creatives bridge state
    const [showAiGenerate, setShowAiGenerate] = useState(false);
    const [showGalleryPicker, setShowGalleryPicker] = useState(false);
    const [genPrompt, setGenPrompt] = useState('');
    const [genStyle, setGenStyle] = useState('photorealistic');
    const [genGenerating, setGenGenerating] = useState(false);
    const [genError, setGenError] = useState<string | null>(null);
    const [galleryImages, setGalleryImages] = useState<Array<{ id: string; blobUrl: string; prompt: string; style: string; tags: string[] }>>([]);
    const [gallerySearch, setGallerySearch] = useState('');
    const [galleryLoading, setGalleryLoading] = useState(false);
    const genPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const csvFileRef = useRef<HTMLInputElement>(null);

    // Pre-fill from query params (mediaUrl from Creatives) + sessionStorage (from Research)
    useEffect(() => {
        const prefillUrl = searchParams.get('mediaUrl');
        if (prefillUrl) {
            setMediaUrls([prefillUrl]);
            setMediaPreviews([prefillUrl]);
            setMediaType(prefillUrl.match(/\.(mp4|mov|webm)$/i) ? 'video' : 'photo');
        }

        // Read research prefill from sessionStorage
        try {
            const prefill = JSON.parse(sessionStorage.getItem('research_prefill') || 'null');
            if (prefill) {
                if (prefill.caption) setCaption(prefill.caption);
                if (prefill.platforms) setPlatforms(prefill.platforms);
                if (prefill.postType) setPostType(prefill.postType);
                sessionStorage.removeItem('research_prefill');
            }
        } catch { /* ignore parse errors */ }

        if (prefillUrl) {
            window.history.replaceState({}, '', '/publish');
        }
    }, [searchParams]);

    // Pre-fill from editing post
    useEffect(() => {
        if (editingPost) {
            setCaption(editingPost.caption || '');
            setPlatforms(editingPost.platforms || []);
            setPostType((editingPost.postType as PostType) || 'feed');
            if (editingPost.mediaUrls?.length) {
                setMediaUrls(editingPost.mediaUrls);
                setMediaPreviews(editingPost.mediaUrls);
                setMediaType(editingPost.mediaUrls[0].match(/\.(mp4|mov|webm)$/i) ? 'video' : 'photo');
            }
            if (editingPost.scheduledFor) {
                // Display in Eastern Time
                const d = new Date(editingPost.scheduledFor);
                const etDate = d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); // yyyy-MM-dd
                const etTime = d.toLocaleTimeString('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }); // HH:mm
                setScheduleDate(etDate);
                setScheduleTime(etTime);
            }
            const meta = editingPost.metadata as any;
            if (meta?.gbpLocations) {
                setGbpLocations(meta.gbpLocations);
            }
            setBulkMode(false);
            setFeedback(null);
        }
    }, [editingPost]);

    const togglePlatform = (p: Platform) => {
        setPlatforms(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);
    };

    const uploadFiles = async (files: File[]) => {
        const maxImages = 10;
        const remaining = maxImages - mediaUrls.length;
        if (remaining <= 0) {
            setUploadError(`Maximum ${maxImages} images allowed for carousel`);
            return;
        }
        const batch = files.slice(0, remaining);

        setUploading(true);
        setUploadError(null);

        // Detect type from first file
        const firstType = batch[0]?.type.startsWith('video/') ? 'video' : 'photo';
        if (!mediaType) setMediaType(firstType as 'photo' | 'video');

        // Add previews immediately
        const newPreviews = batch.map(f => URL.createObjectURL(f));
        setMediaPreviews(prev => [...prev, ...newPreviews]);

        try {
            const uploadedUrls: string[] = [];
            for (const file of batch) {
                const ext = file.name.split('.').pop() || 'jpg';
                const cleanName = file.name
                    .replace(/\.[^/.]+$/, '')
                    .replace(/[^a-zA-Z0-9-_]/g, '_')
                    .substring(0, 50);
                const filename = `publish/${cleanName}_${Date.now()}_${Math.random().toString(36).substr(2, 4)}.${ext}`;

                const blob = await upload(filename, file, {
                    access: 'public',
                    handleUploadUrl: '/api/upload/token',
                });
                uploadedUrls.push(blob.url);
            }

            setMediaUrls(prev => [...prev, ...uploadedUrls]);
            // Replace local previews with uploaded URLs
            setMediaPreviews(prev => {
                const existing = prev.slice(0, prev.length - newPreviews.length);
                return [...existing, ...uploadedUrls];
            });
        } catch (err: any) {
            setUploadError(err.message || 'Upload failed');
            // Remove failed previews
            setMediaPreviews(prev => prev.slice(0, prev.length - newPreviews.length));
            newPreviews.forEach(p => URL.revokeObjectURL(p));
        } finally {
            setUploading(false);
        }
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            uploadFiles(Array.from(e.target.files));
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            uploadFiles(Array.from(e.dataTransfer.files));
        }
    };

    const removeMedia = (index: number) => {
        setMediaUrls(prev => prev.filter((_, i) => i !== index));
        setMediaPreviews(prev => {
            const url = prev[index];
            if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
            return prev.filter((_, i) => i !== index);
        });
        if (mediaUrls.length <= 1) {
            setMediaType(null);
        }
    };

    const clearMedia = () => {
        mediaPreviews.forEach(p => { if (p.startsWith('blob:')) URL.revokeObjectURL(p); });
        setMediaUrls([]);
        setMediaPreviews([]);
        setMediaType(null);
        setUploadError(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const clearForm = () => {
        setCaption(''); setPlatforms([]); setPostType('feed' as PostType); clearMedia();
        setScheduleDate(''); setScheduleTime(''); setFeedback(null); setScheduleError(null);
        setAiSuggestions([]); setShowAiGenerate(false); setShowGalleryPicker(false);
        setGenPrompt(''); setGenError(null);
        onCancelEdit();
    };

    // Cleanup generate polling on unmount
    useEffect(() => {
        return () => { if (genPollRef.current) clearInterval(genPollRef.current); };
    }, []);

    const handleInlineGenerate = async () => {
        if (!genPrompt.trim()) return;
        setGenGenerating(true);
        setGenError(null);
        try {
            const ar = (postType === 'story' || postType === 'reel') ? '9:16' : '1:1';
            const res = await fetch('/api/creatives/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: genPrompt.trim(), style: genStyle, aspectRatio: ar, resolution: '2048', variations: 1, tags: [] }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed');

            const task = data.tasks?.[0] || { taskId: data.taskId, id: data.id };

            // Start polling
            genPollRef.current = setInterval(async () => {
                try {
                    const pollRes = await fetch(`/api/creatives/generate?taskId=${task.taskId}&id=${task.id}`);
                    const pollData = await pollRes.json();
                    if (pollData.status === 'success' && pollData.blobUrl) {
                        if (genPollRef.current) clearInterval(genPollRef.current);
                        setMediaUrls(prev => [...prev, pollData.blobUrl]);
                        setMediaPreviews(prev => [...prev, pollData.blobUrl]);
                        setMediaType('photo');
                        setGenGenerating(false);
                        setShowAiGenerate(false);
                        setGenPrompt('');
                    } else if (pollData.status === 'failed') {
                        if (genPollRef.current) clearInterval(genPollRef.current);
                        setGenError(pollData.failMsg || 'Generation failed');
                        setGenGenerating(false);
                    }
                } catch { /* continue polling */ }
            }, 5000);
        } catch (err: unknown) {
            setGenGenerating(false);
            setGenError(err instanceof Error ? err.message : 'Generation failed');
        }
    };

    const fetchGallery = async (search?: string) => {
        setGalleryLoading(true);
        try {
            const params = new URLSearchParams();
            if (search) params.set('search', search);
            const res = await fetch(`/api/creatives/history?${params}`);
            const data = await res.json();
            setGalleryImages((data.images || []).filter((img: any) => img.blobUrl));
        } catch { /* ignore */ }
        setGalleryLoading(false);
    };

    const selectGalleryImage = (blobUrl: string) => {
        setMediaUrls(prev => [...prev, blobUrl]);
        setMediaPreviews(prev => [...prev, blobUrl]);
        setMediaType('photo');
        setShowGalleryPicker(false);
    };

    const handleCreate = async () => {
        if (!caption || platforms.length === 0) return;

        // Schedule validation
        if ((scheduleDate && !scheduleTime) || (!scheduleDate && scheduleTime)) {
            setScheduleError('Both date and time are required for scheduling');
            return;
        }
        setScheduleError(null);

        // Post type validation
        if (postType === 'reel' && mediaType !== 'video') {
            setFeedback({ type: 'error', message: 'Reels require a video file (MP4 or MOV).' });
            return;
        }
        if (postType === 'story' && mediaUrls.length === 0) {
            setFeedback({ type: 'error', message: 'Stories require a photo or video.' });
            return;
        }
        if (platforms.includes('google-business') && gbpLocations.length === 0) {
            setFeedback({ type: 'error', message: 'Select at least one Google Business location.' });
            return;
        }

        setSubmitting(true);
        setFeedback(null);

        try {
            let scheduledFor = undefined;
            if (scheduleDate && scheduleTime) {
                // Interpret schedule as Eastern Time (America/New_York handles EST/EDT automatically)
                // Create a date formatter that tells us the UTC offset for ET on this date
                const probe = new Date(`${scheduleDate}T${scheduleTime}:00Z`);
                const etParts = new Intl.DateTimeFormat('en-US', {
                    timeZone: 'America/New_York',
                    timeZoneName: 'shortOffset',
                    year: 'numeric', month: '2-digit', day: '2-digit',
                    hour: '2-digit', minute: '2-digit', hour12: false,
                }).formatToParts(probe);
                const tzPart = etParts.find(p => p.type === 'timeZoneName')?.value || 'GMT-5';
                const offsetMatch = tzPart.match(/GMT([+-]\d+)/);
                const offsetHours = offsetMatch ? parseInt(offsetMatch[1]) : -5;
                const offset = `${offsetHours >= 0 ? '+' : '-'}${String(Math.abs(offsetHours)).padStart(2, '0')}:00`;
                scheduledFor = new Date(`${scheduleDate}T${scheduleTime}:00${offset}`).toISOString();
            }

            if (editingPost && editingPost.id) {
                // Edit existing scheduled post
                const res = await fetch('/api/content/publish', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id: editingPost.id,
                        caption,
                        platforms,
                        postType,
                        scheduledFor,
                        mediaUrls,
                        ...(platforms.includes('google-business') && { gbpLocations }),
                    })
                });

                const data = await res.json();
                if (res.ok) {
                    setFeedback({ type: 'success', message: 'Scheduled post updated successfully!' });
                    clearForm();
                    onPostCreated();
                } else {
                    setFeedback({ type: 'error', message: data.error || 'Failed to update post' });
                }
            } else {
                // Create new post
                const res = await fetch('/api/content/publish', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        platforms,
                        caption,
                        mediaUrls,
                        postType,
                        scheduledFor,
                        ...(platforms.includes('google-business') && { gbpLocations }),
                    })
                });

                const data = await res.json();

                if (res.ok) {
                    const post = data.post;
                    const results = data.results || [];

                    if (post.status === 'PUBLISHED') {
                        setFeedback({
                            type: 'success',
                            message: `Published to ${platforms.join(' & ')}!`,
                            details: results.filter((r: any) => r.success).map((r: any) => `${r.platform}: Post ID ${r.postId}`),
                        });
                        clearForm();
                    } else if (post.status === 'PARTIAL') {
                        const successes = results.filter((r: any) => r.success);
                        const failures = results.filter((r: any) => !r.success);
                        setFeedback({
                            type: 'partial',
                            message: `Partially published (${successes.length}/${results.length} platforms)`,
                            details: [
                                ...successes.map((r: any) => `${r.platform}: Published`),
                                ...failures.map((r: any) => `${r.platform}: ${r.error}`),
                            ],
                        });
                    } else if (post.status === 'SCHEDULED') {
                        setFeedback({
                            type: 'success',
                            message: `Scheduled for ${new Date(scheduledFor!).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })} ET`,
                        });
                        clearForm();
                    } else {
                        const errors = results.filter((r: any) => !r.success);
                        setFeedback({
                            type: 'error',
                            message: 'Publishing failed',
                            details: errors.map((r: any) => `${r.platform}: ${r.error}`),
                        });
                    }

                    onPostCreated();
                } else {
                    setFeedback({ type: 'error', message: data.error || 'Something went wrong' });
                }
            }
        } catch (e: any) {
            setFeedback({ type: 'error', message: e.message || 'Network error' });
        } finally {
            setSubmitting(false);
        }
    };

    // AI Caption Assist
    const handleAiSuggest = async () => {
        setAiLoading(true);
        setAiSuggestions([]);
        try {
            const res = await fetch('/api/content/suggest-caption', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    platforms,
                    postType,
                    captionFragment: caption,
                }),
            });
            const data = await res.json();
            if (data.suggestions) {
                setAiSuggestions(data.suggestions);
            } else {
                setFeedback({ type: 'error', message: data.error || 'AI suggestion failed' });
            }
        } catch {
            setFeedback({ type: 'error', message: 'Failed to get AI suggestions' });
        } finally {
            setAiLoading(false);
        }
    };

    // Bulk CSV handlers
    const handleCsvFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => setCsvText(reader.result as string);
        reader.readAsText(file);
    };

    const handleCsvPreview = async () => {
        if (!csvText.trim()) return;
        setCsvLoading(true);
        try {
            const res = await fetch('/api/content/bulk-upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ csv: csvText, action: 'preview' }),
            });
            const data = await res.json();
            setCsvPreview(data);
        } catch {
            setFeedback({ type: 'error', message: 'Failed to parse CSV' });
        } finally {
            setCsvLoading(false);
        }
    };

    const handleCsvConfirm = async () => {
        setCsvLoading(true);
        try {
            const res = await fetch('/api/content/bulk-upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ csv: csvText, action: 'confirm' }),
            });
            const data = await res.json();
            if (data.created > 0) {
                setFeedback({ type: 'success', message: `Scheduled ${data.created} post(s)!${data.skippedInvalid > 0 ? ` (${data.skippedInvalid} invalid rows skipped)` : ''}` });
                setCsvText('');
                setCsvPreview(null);
                onPostCreated();
            } else {
                setFeedback({ type: 'error', message: 'No posts were created' });
            }
        } catch {
            setFeedback({ type: 'error', message: 'Bulk upload failed' });
        } finally {
            setCsvLoading(false);
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

    // ── Bulk Mode ──
    if (bulkMode) {
        return (
            <div className="section-card" style={{ padding: '32px', maxWidth: '900px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
                    <h3 style={{ margin: 0, fontSize: '1rem' }}>Bulk CSV Upload</h3>
                    <button onClick={() => { setBulkMode(false); setCsvPreview(null); setCsvText(''); }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8125rem' }}>
                        Switch to Single Post
                    </button>
                </div>

                {/* Feedback Banner */}
                {feedback && (() => {
                    const fb = feedbackColors[feedback.type];
                    const Icon = fb.icon;
                    return (
                        <div style={{ background: fb.bg, border: `1px solid ${fb.border}`, borderRadius: '12px', padding: '16px 20px', display: 'flex', gap: '12px', alignItems: 'flex-start', marginBottom: '20px' }}>
                            <Icon size={20} style={{ color: fb.color, flexShrink: 0, marginTop: '2px' }} />
                            <div style={{ flex: 1 }}>
                                <p style={{ color: fb.color, fontWeight: 600, fontSize: '0.9375rem', margin: 0 }}>{feedback.message}</p>
                            </div>
                            <button onClick={() => setFeedback(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}>
                                <X size={14} />
                            </button>
                        </div>
                    );
                })()}

                <div style={{ marginBottom: '16px', padding: '12px 16px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <p style={{ margin: '0 0 6px', fontSize: '0.8125rem', fontWeight: 500, color: '#ccc' }}>CSV Format</p>
                    <code style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.8 }}>
                        date,time,platforms,post_type,caption,media_url,gbp_locations<br />
                        2026-03-10,09:00,instagram|facebook,feed,&quot;Your caption here&quot;,,<br />
                        2026-03-11,10:00,google-business,feed,&quot;GBP post&quot;,,decatur|smyrna
                    </code>
                    <p style={{ margin: '8px 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        Max {21} rows (3/day x 7 days). Platforms and GBP locations are pipe-separated.
                    </p>
                </div>

                <p style={{ fontSize: '0.75rem', color: '#eab308', margin: '0 0 16px' }}>
                    All times are Eastern Time (ET). Posts publish automatically at their scheduled time.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div>
                        <input type="file" ref={csvFileRef} accept=".csv,text/csv" onChange={handleCsvFile} style={{ display: 'none' }} />
                        <button onClick={() => csvFileRef.current?.click()} style={{
                            padding: '10px 20px', borderRadius: '10px', border: '1px dashed rgba(255,255,255,0.15)',
                            background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
                            fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '8px',
                        }}>
                            <FileText size={16} /> Upload CSV File
                        </button>
                    </div>

                    {csvText && (
                        <textarea
                            value={csvText}
                            onChange={e => { setCsvText(e.target.value); setCsvPreview(null); }}
                            style={{ ...inputStyle, height: '150px', resize: 'vertical', fontFamily: 'monospace', fontSize: '0.8125rem', lineHeight: 1.6 }}
                        />
                    )}

                    {csvText && !csvPreview && (
                        <button onClick={handleCsvPreview} disabled={csvLoading} style={{
                            padding: '10px 24px', borderRadius: '10px', border: 'none', cursor: 'pointer',
                            fontSize: '0.875rem', fontWeight: 600, background: 'rgba(255,255,255,0.1)',
                            color: '#fff', display: 'flex', alignItems: 'center', gap: '8px', width: 'fit-content',
                        }}>
                            {csvLoading ? <Loader2 size={16} style={{ animation: 'spin 0.8s linear infinite' }} /> : <Eye size={16} />}
                            Preview
                        </button>
                    )}

                    {/* CSV Preview Table */}
                    {csvPreview && (
                        <div>
                            <div style={{ display: 'flex', gap: '16px', marginBottom: '12px' }}>
                                <span style={{ fontSize: '0.8125rem', color: '#22c55e' }}>Valid: {csvPreview.validCount}</span>
                                {csvPreview.invalidCount > 0 && <span style={{ fontSize: '0.8125rem', color: '#ef4444' }}>Invalid: {csvPreview.invalidCount}</span>}
                            </div>

                            <div style={{ borderRadius: '10px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)' }}>
                                {csvPreview.rows?.map((row: any, i: number) => (
                                    <div key={i} style={{
                                        padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '12px',
                                        background: i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent',
                                        borderBottom: '1px solid rgba(255,255,255,0.04)',
                                    }}>
                                        {row.valid ? (
                                            <CheckCircle size={14} style={{ color: '#22c55e', flexShrink: 0 }} />
                                        ) : (
                                            <XCircle size={14} style={{ color: '#ef4444', flexShrink: 0 }} />
                                        )}
                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', width: '80px', flexShrink: 0 }}>{row.date} {row.time}</span>
                                        <div style={{ display: 'flex', gap: '3px', flexShrink: 0 }}>
                                            {row.platforms?.map((p: string) => {
                                                const meta = platformMeta[p];
                                                if (!meta) return null;
                                                const Icon = meta.icon;
                                                return <Icon key={p} size={12} style={{ color: meta.color }} />;
                                            })}
                                        </div>
                                        <span style={{ fontSize: '0.8125rem', color: '#ccc', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {row.caption}
                                        </span>
                                        {!row.valid && (
                                            <span style={{ fontSize: '0.6875rem', color: '#ef4444', flexShrink: 0 }}>
                                                {row.errors?.[0]}
                                            </span>
                                        )}
                                    </div>
                                ))}
                            </div>

                            {csvPreview.validCount > 0 && (
                                <button onClick={handleCsvConfirm} disabled={csvLoading} style={{
                                    marginTop: '16px', padding: '12px 28px', borderRadius: '10px', border: 'none',
                                    cursor: 'pointer', fontSize: '0.9375rem', fontWeight: 600,
                                    background: 'var(--accent)', color: '#000',
                                    display: 'flex', alignItems: 'center', gap: '8px',
                                }}>
                                    {csvLoading ? <Loader2 size={18} style={{ animation: 'spin 0.8s linear infinite' }} /> : <Calendar size={18} />}
                                    Schedule {csvPreview.validCount} Post{csvPreview.validCount > 1 ? 's' : ''}
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // ── Single Post Mode ──
    return (
        <div className="section-card" style={{ padding: '32px', maxWidth: '900px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
                <h3 style={{ margin: 0, fontSize: '1rem' }}>
                    {editingPost ? 'Edit Scheduled Post' : 'Craft Post'}
                </h3>
                <div style={{ display: 'flex', gap: '8px' }}>
                    {editingPost && (
                        <button onClick={clearForm} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.8125rem' }}>
                            Cancel Edit
                        </button>
                    )}
                    {!editingPost && (
                        <button onClick={() => setBulkMode(true)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8125rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <FileText size={12} /> Bulk Upload
                        </button>
                    )}
                </div>
            </div>

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
                            <button onClick={() => setFeedback(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}>
                                <X size={14} />
                            </button>
                        </div>
                    );
                })()}

                {/* Platform Selection */}
                <div>
                    <label style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--text-muted)', display: 'block', marginBottom: '12px' }}>Publish To</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                        {(['instagram', 'facebook', 'google-business', 'youtube'] as Platform[]).map((p) => {
                            const isSelected = platforms.includes(p);
                            const meta = platformMeta[p];
                            const isYT = p === 'youtube';
                            return (
                                <button
                                    key={p}
                                    onClick={() => !isYT && togglePlatform(p)}
                                    style={{
                                        padding: '10px 20px', borderRadius: '10px', border: 'none', cursor: isYT ? 'not-allowed' : 'pointer',
                                        fontSize: '0.875rem', fontWeight: isSelected ? 600 : 400,
                                        display: 'flex', alignItems: 'center', gap: '8px',
                                        background: isSelected ? `${meta.color}20` : 'rgba(255,255,255,0.05)',
                                        color: isYT ? 'rgba(255,255,255,0.2)' : (isSelected ? meta.color : 'var(--text-muted)'),
                                        transition: 'all 0.2s',
                                        opacity: isYT ? 0.5 : 1,
                                    }}
                                    title={isYT ? 'YouTube publishing requires YouTube Studio' : undefined}
                                >
                                    <meta.icon size={16} />
                                    {meta.label}
                                    {isYT && <span style={{ fontSize: '0.6875rem', opacity: 0.6 }}>(Soon)</span>}
                                </button>
                            );
                        })}
                    </div>

                    {/* GBP Location Selector */}
                    {platforms.includes('google-business') && (
                        <div style={{ marginTop: '12px', padding: '12px 16px', background: 'rgba(66,133,244,0.08)', borderRadius: '8px', border: '1px solid rgba(66,133,244,0.2)' }}>
                            <label style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--text-muted)', display: 'block', marginBottom: '8px' }}>Post to Locations</label>
                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                {[
                                    { key: 'decatur', label: 'Decatur' },
                                    { key: 'smyrna', label: 'Smyrna/Vinings' },
                                    { key: 'kennesaw', label: 'Kennesaw' },
                                ].map(loc => {
                                    const selected = gbpLocations.includes(loc.key);
                                    return (
                                        <button
                                            key={loc.key}
                                            onClick={() => setGbpLocations(prev =>
                                                selected ? prev.filter(l => l !== loc.key) : [...prev, loc.key]
                                            )}
                                            style={{
                                                padding: '6px 14px', borderRadius: '6px', border: 'none', cursor: 'pointer',
                                                fontSize: '0.8125rem', fontWeight: selected ? 600 : 400,
                                                background: selected ? 'rgba(66,133,244,0.2)' : 'rgba(255,255,255,0.05)',
                                                color: selected ? '#4285F4' : 'var(--text-muted)',
                                                transition: 'all 0.2s',
                                            }}
                                        >
                                            {loc.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>

                {/* Post Type */}
                <div>
                    <label style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--text-muted)', display: 'block', marginBottom: '12px' }}>Post Type</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                        {([
                            { value: 'feed' as PostType, label: 'Feed Post', icon: ImageIcon, desc: 'Standard post' },
                            { value: 'reel' as PostType, label: 'Reel', icon: Film, desc: 'Short video' },
                            { value: 'story' as PostType, label: 'Story', icon: Clock, desc: '24h ephemeral' },
                        ]).map(({ value, label, icon: Icon, desc }) => {
                            const isSelected = postType === value;
                            return (
                                <button
                                    key={value}
                                    onClick={() => setPostType(value)}
                                    style={{
                                        padding: '10px 20px', borderRadius: '10px', border: 'none', cursor: 'pointer',
                                        fontSize: '0.875rem', fontWeight: isSelected ? 600 : 400,
                                        display: 'flex', alignItems: 'center', gap: '8px',
                                        background: isSelected ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)',
                                        color: isSelected ? '#fff' : 'var(--text-muted)',
                                        transition: 'all 0.2s',
                                    }}
                                >
                                    <Icon size={16} />
                                    {label}
                                    <span style={{ fontSize: '0.6875rem', opacity: 0.6 }}>({desc})</span>
                                </button>
                            );
                        })}
                    </div>
                    {postType === 'reel' && (
                        <p style={{ fontSize: '0.75rem', color: '#eab308', marginTop: '6px' }}>Reels require a video file (MP4/MOV).</p>
                    )}
                    {postType === 'story' && (
                        <p style={{ fontSize: '0.75rem', color: '#eab308', marginTop: '6px' }}>Stories require a photo or video. They disappear after 24 hours.</p>
                    )}
                </div>

                {/* Caption + AI Assist */}
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                        <label style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--text-muted)' }}>Caption</label>
                        <button
                            onClick={handleAiSuggest}
                            disabled={aiLoading || platforms.length === 0}
                            style={{
                                background: 'none', border: '1px solid rgba(168,85,247,0.3)', borderRadius: '8px',
                                padding: '5px 12px', cursor: platforms.length === 0 ? 'not-allowed' : 'pointer',
                                fontSize: '0.75rem', fontWeight: 500,
                                color: platforms.length === 0 ? 'var(--text-muted)' : '#a855f7',
                                display: 'flex', alignItems: 'center', gap: '5px',
                                opacity: platforms.length === 0 ? 0.4 : 1,
                                transition: 'all 0.2s',
                            }}
                            title={platforms.length === 0 ? 'Select platforms first' : 'Get AI caption suggestions'}
                        >
                            {aiLoading ? <Loader2 size={12} style={{ animation: 'spin 0.8s linear infinite' }} /> : <Sparkles size={12} />}
                            AI Suggest
                        </button>
                    </div>
                    <textarea
                        value={caption}
                        onChange={e => setCaption(e.target.value)}
                        placeholder="Write something engaging..."
                        style={{ ...inputStyle, height: '120px', resize: 'none', lineHeight: 1.6 }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px' }}>
                        <span style={{ fontSize: '0.75rem', color: caption.length > 2200 ? '#ef4444' : 'var(--text-muted)' }}>{caption.length}/2,200</span>
                    </div>

                    {/* AI Suggestions */}
                    {aiSuggestions.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
                            <p style={{ fontSize: '0.75rem', color: '#a855f7', margin: 0, fontWeight: 500 }}>Click to use a suggestion:</p>
                            {aiSuggestions.map((suggestion, i) => (
                                <button
                                    key={i}
                                    onClick={() => { setCaption(suggestion); setAiSuggestions([]); }}
                                    style={{
                                        padding: '12px 16px', borderRadius: '10px', textAlign: 'left',
                                        border: '1px solid rgba(168,85,247,0.15)', cursor: 'pointer',
                                        background: 'rgba(168,85,247,0.04)', color: '#ddd',
                                        fontSize: '0.8125rem', lineHeight: 1.6, transition: 'all 0.2s',
                                    }}
                                >
                                    {suggestion.length > 200 ? suggestion.substring(0, 200) + '...' : suggestion}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Media Upload */}
                <div>
                    <label style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--text-muted)', display: 'block', marginBottom: '12px' }}>
                        Photo or Video
                        {platforms.includes('instagram') && <span style={{ color: '#E1306C', marginLeft: '8px', fontSize: '0.75rem' }}>Required for Instagram</span>}
                    </label>

                    <input type="file" ref={fileInputRef} onChange={handleFileSelect} style={{ display: 'none' }} accept="image/*,video/*" multiple />

                    {/* Media Preview Grid */}
                    {mediaPreviews.length > 0 && (
                        <div style={{ marginBottom: '12px' }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '8px' }}>
                                {mediaPreviews.map((preview, idx) => (
                                    <div key={idx} style={{ position: 'relative', display: 'inline-block' }}>
                                        {mediaType === 'video' && idx === 0 ? (
                                            <video src={preview} controls style={{ height: '120px', maxWidth: '200px', borderRadius: '10px', border: '1px solid var(--border-color)' }} />
                                        ) : (
                                            <img src={preview} alt={`Media ${idx + 1}`} style={{ height: '120px', width: '120px', borderRadius: '10px', border: '1px solid var(--border-color)', objectFit: 'cover' }} />
                                        )}
                                        {/* Upload success badge */}
                                        {!uploading && mediaUrls[idx] && (
                                            <div style={{
                                                position: 'absolute', top: '6px', left: '6px',
                                                background: 'rgba(34,197,94,0.9)', borderRadius: '50%',
                                                width: '22px', height: '22px', display: 'flex',
                                                alignItems: 'center', justifyContent: 'center',
                                            }}>
                                                <CheckCircle size={12} style={{ color: '#fff' }} />
                                            </div>
                                        )}
                                        {/* Remove button */}
                                        {!uploading && (
                                            <button onClick={() => removeMedia(idx)} style={{
                                                position: 'absolute', top: '-6px', right: '-6px',
                                                width: '22px', height: '22px', borderRadius: '50%',
                                                background: '#ef4444', border: 'none', cursor: 'pointer',
                                                color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            }}>
                                                <X size={10} />
                                            </button>
                                        )}
                                    </div>
                                ))}
                                {uploading && (
                                    <div style={{
                                        height: '120px', width: '120px', borderRadius: '10px',
                                        background: 'rgba(255,255,255,0.04)', display: 'flex', flexDirection: 'column',
                                        alignItems: 'center', justifyContent: 'center', gap: '6px',
                                        border: '1px solid var(--border-color)',
                                    }}>
                                        <Loader2 size={20} style={{ color: 'var(--accent)', animation: 'spin 0.8s linear infinite' }} />
                                        <span style={{ color: 'var(--text-muted)', fontSize: '0.6875rem' }}>Uploading...</span>
                                    </div>
                                )}
                            </div>
                            {mediaPreviews.length > 1 && (
                                <p style={{ fontSize: '0.75rem', color: 'var(--accent)', margin: '0 0 4px' }}>
                                    {mediaPreviews.length} images — will publish as carousel
                                </p>
                            )}
                            {mediaPreviews.length < 10 && !uploading && (
                                <button onClick={() => fileInputRef.current?.click()} style={{
                                    padding: '6px 14px', borderRadius: '8px', fontSize: '0.75rem',
                                    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                                    color: 'var(--text-muted)', cursor: 'pointer',
                                }}>
                                    + Add more images
                                </button>
                            )}
                        </div>
                    )}

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

                    {mediaPreviews.length === 0 && (
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

                {/* Creative Options */}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                        onClick={() => { setShowAiGenerate(!showAiGenerate); setShowGalleryPicker(false); }}
                        style={{
                            padding: '7px 14px', borderRadius: '8px', fontSize: '0.75rem', fontWeight: 500,
                            background: showAiGenerate ? 'rgba(234,179,8,0.1)' : 'rgba(255,255,255,0.04)',
                            border: `1px solid ${showAiGenerate ? 'var(--accent)' : 'rgba(255,255,255,0.08)'}`,
                            color: showAiGenerate ? 'var(--accent)' : 'var(--text-muted)',
                            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px',
                        }}
                    >
                        <Sparkles size={13} /> AI Generate Image
                    </button>
                    <button
                        onClick={() => { setShowGalleryPicker(true); setShowAiGenerate(false); fetchGallery(); }}
                        style={{
                            padding: '7px 14px', borderRadius: '8px', fontSize: '0.75rem', fontWeight: 500,
                            background: 'rgba(255,255,255,0.04)',
                            border: '1px solid rgba(255,255,255,0.08)',
                            color: 'var(--text-muted)',
                            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px',
                        }}
                    >
                        <ImageIcon size={13} /> Browse Gallery
                    </button>
                </div>

                {/* Inline AI Generate */}
                {showAiGenerate && (
                    <div style={{ padding: '16px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)' }}>
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                            <input
                                type="text"
                                value={genPrompt}
                                onChange={e => setGenPrompt(e.target.value)}
                                placeholder="Describe the image you want..."
                                disabled={genGenerating}
                                style={{
                                    flex: 1, padding: '10px 14px', borderRadius: '8px', fontSize: '0.8125rem',
                                    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                                    color: '#fff', outline: 'none',
                                }}
                                onKeyDown={e => e.key === 'Enter' && handleInlineGenerate()}
                            />
                            <select
                                value={genStyle}
                                onChange={e => setGenStyle(e.target.value)}
                                disabled={genGenerating}
                                style={{
                                    padding: '10px 12px', borderRadius: '8px', fontSize: '0.75rem',
                                    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                                    color: '#ccc', outline: 'none',
                                }}
                            >
                                <option value="photorealistic">Photorealistic</option>
                                <option value="cinematic">Cinematic</option>
                                <option value="product-shot">Product Shot</option>
                                <option value="fashion">Fashion</option>
                                <option value="beauty-closeup">Beauty Close-up</option>
                                <option value="logo-design">Logo Design</option>
                            </select>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <button
                                onClick={handleInlineGenerate}
                                disabled={genGenerating || !genPrompt.trim()}
                                style={{
                                    padding: '8px 18px', borderRadius: '8px', fontSize: '0.75rem', fontWeight: 600,
                                    background: 'var(--accent)', border: 'none', color: '#000', cursor: 'pointer',
                                    opacity: genGenerating || !genPrompt.trim() ? 0.5 : 1,
                                    display: 'flex', alignItems: 'center', gap: '6px',
                                }}
                            >
                                {genGenerating ? <Loader2 size={13} style={{ animation: 'spin 0.8s linear infinite' }} /> : <Sparkles size={13} />}
                                {genGenerating ? 'Generating...' : 'Generate'}
                            </button>
                            <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                                Auto: {(postType === 'story' || postType === 'reel') ? '9:16' : '1:1'} · 2K resolution
                            </span>
                        </div>
                        {genError && <p style={{ margin: '8px 0 0', fontSize: '0.75rem', color: '#ef4444' }}>{genError}</p>}
                    </div>
                )}

                {/* Gallery Picker Overlay */}
                {showGalleryPicker && (
                    <div className="gallery-picker-overlay" style={{
                        position: 'fixed', inset: 0, zIndex: 100,
                        background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)',
                        display: 'flex', flexDirection: 'column', padding: '24px',
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                            <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 600 }}>Select from Gallery</h3>
                            <button onClick={() => setShowGalleryPicker(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                                <X size={20} />
                            </button>
                        </div>
                        <div style={{ marginBottom: '16px' }}>
                            <input
                                type="text"
                                value={gallerySearch}
                                onChange={e => { setGallerySearch(e.target.value); fetchGallery(e.target.value); }}
                                placeholder="Search by prompt..."
                                style={{
                                    width: '100%', maxWidth: '400px', padding: '10px 14px', borderRadius: '8px',
                                    fontSize: '0.8125rem', background: 'rgba(255,255,255,0.06)',
                                    border: '1px solid rgba(255,255,255,0.1)', color: '#fff', outline: 'none',
                                }}
                            />
                        </div>
                        <div style={{ flex: 1, overflow: 'auto' }}>
                            {galleryLoading ? (
                                <div style={{ textAlign: 'center', padding: '60px 0' }}>
                                    <Loader2 size={24} style={{ color: 'var(--accent)', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} />
                                </div>
                            ) : galleryImages.length === 0 ? (
                                <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '60px 0' }}>No images found. Generate some on the Creatives page first.</p>
                            ) : (
                                <div className="gallery-picker-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px' }}>
                                    {galleryImages.map(img => (
                                        <div
                                            key={img.id}
                                            onClick={() => selectGalleryImage(img.blobUrl)}
                                            style={{
                                                cursor: 'pointer', borderRadius: '10px', overflow: 'hidden',
                                                border: '1px solid rgba(255,255,255,0.06)', transition: 'border-color 0.15s',
                                            }}
                                            onMouseOver={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                                            onMouseOut={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)')}
                                        >
                                            <img src={img.blobUrl} alt="" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover' }} />
                                            <div style={{ padding: '8px' }}>
                                                <p style={{ margin: 0, fontSize: '0.6875rem', color: '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {img.prompt}
                                                </p>
                                                <span style={{ fontSize: '0.5625rem', color: 'var(--text-muted)' }}>{img.style}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Schedule */}
                <div>
                    <label style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--text-muted)', display: 'block', marginBottom: '12px' }}>Schedule (optional — Eastern Time)</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
                        <input
                            type="date"
                            value={scheduleDate}
                            onChange={e => { setScheduleDate(e.target.value); setScheduleError(null); }}
                            style={{
                                ...inputStyle, width: 'auto', colorScheme: 'dark',
                                ...(scheduleError && !scheduleDate ? { outline: '1px solid #ef4444' } : {}),
                            }}
                        />
                        <input
                            type="time"
                            value={scheduleTime}
                            onChange={e => { setScheduleTime(e.target.value); setScheduleError(null); }}
                            style={{
                                ...inputStyle, width: 'auto', colorScheme: 'dark',
                                ...(scheduleError && !scheduleTime ? { outline: '1px solid #ef4444' } : {}),
                            }}
                        />
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>ET</span>
                    </div>
                    {scheduleError ? (
                        <p style={{ fontSize: '0.75rem', color: '#ef4444', marginTop: '6px' }}>{scheduleError}</p>
                    ) : (
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '6px' }}>
                            Leave blank to publish immediately.
                            {(scheduleDate || scheduleTime) && ' All times are Eastern Time (ET).'}
                        </p>
                    )}
                </div>

                {/* Submit */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    <button
                        onClick={clearForm}
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
                            <><Loader2 size={18} style={{ animation: 'spin 0.8s linear infinite' }} /> {editingPost ? 'Saving...' : 'Publishing...'}</>
                        ) : (
                            <>
                                {editingPost ? <Edit3 size={18} /> : (scheduleDate ? <Calendar size={18} /> : <Send size={18} />)}
                                {editingPost ? 'Save Changes' : (scheduleDate ? 'Schedule' : 'Publish Now')}
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Queue Calendar View ────────────────────────────────────────────────────

function QueueCalendar({ posts, onUpdate, onEdit }: { posts: PostRecord[], onUpdate: () => void, onEdit: (post: PostRecord) => void }) {
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

function QueueList({ posts, onUpdate, onEdit }: { posts: PostRecord[], onUpdate: () => void, onEdit: (post: PostRecord) => void }) {
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

function HistoryList({ posts, showArchived, onToggleArchived }: {
    posts: PostRecord[];
    showArchived: boolean;
    onToggleArchived: () => void;
}) {
    const [statusFilter, setStatusFilter] = useState<string>('ALL');

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

                                    {/* Inline errors */}
                                    {hasErrors && (
                                        <div style={{ marginTop: '8px', padding: '8px 12px', borderRadius: '8px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.12)' }}>
                                            {Object.entries(errors).map(([platform, error]) => (
                                                <p key={platform} style={{ margin: '2px 0', fontSize: '0.75rem', color: '#ef4444' }}>
                                                    {platform}: {error}
                                                </p>
                                            ))}
                                        </div>
                                    )}
                                </div>
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
