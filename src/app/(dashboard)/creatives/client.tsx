'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { upload } from '@vercel/blob/client';
import { Loader2, Download, Send, Image as ImageIcon, Upload, X, ChevronDown, ChevronUp, Trash2, CheckSquare, Square, RefreshCw, Search, Instagram, Facebook, MapPin } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';

// ─── Types ──────────────────────────────────────────────────────────────────

type CreativeStyle = 'photorealistic' | 'cinematic' | 'product-shot' | 'fashion' | 'beauty-closeup' | 'logo-design';
type AspectRatio = '1:1' | '4:5' | '9:16' | '3:4' | '4:3' | '16:9';
type Resolution = '1024' | '2048' | '4096';

interface GalleryImage {
    id: string;
    prompt: string;
    enhancedPrompt: string;
    style: string;
    aspectRatio: string;
    resolution: string;
    blobUrl: string;
    costTimeMs: number;
    createdBy: string;
    createdAt: string;
    tags: string[];
    publishedPlatforms: string[];
    groupId: string | null;
    variationIndex: number;
}

interface PrefillData {
    prompt: string;
    style: CreativeStyle;
    aspectRatio: AspectRatio;
    resolution: Resolution;
    tags: string[];
}

interface UsageData {
    currentMonth: {
        total: number;
        cost: number;
        byResolution: Record<string, { count: number; cost: number }>;
    };
}

const SUGGESTED_TAGS = ['microneedling', 'midface', 'hydrafacial', 'promo', 'before-after', 'skincare', 'lips', 'botox', 'dermal-filler', 'chemical-peel'];

const STYLES: { value: CreativeStyle; label: string; desc: string }[] = [
    { value: 'photorealistic', label: 'Photorealistic', desc: 'Before/after, facility photos' },
    { value: 'cinematic', label: 'Cinematic', desc: 'Dramatic mood, promos' },
    { value: 'product-shot', label: 'Product Shot', desc: 'Skincare, treatments' },
    { value: 'fashion', label: 'Fashion', desc: 'Transformation content' },
    { value: 'beauty-closeup', label: 'Beauty Close-up', desc: 'Skin, lips, results' },
    { value: 'logo-design', label: 'Logo Design', desc: 'Branding, graphics' },
];

const ASPECT_RATIOS: { value: AspectRatio; label: string; use: string }[] = [
    { value: '1:1', label: '1:1', use: 'IG Post' },
    { value: '4:5', label: '4:5', use: 'IG Feed' },
    { value: '9:16', label: '9:16', use: 'IG Story' },
    { value: '3:4', label: '3:4', use: 'Portrait' },
    { value: '4:3', label: '4:3', use: 'Landscape' },
    { value: '16:9', label: '16:9', use: 'FB Cover' },
];

const RESOLUTIONS: { value: Resolution; label: string; desc: string }[] = [
    { value: '1024', label: '1K', desc: 'Fast' },
    { value: '2048', label: '2K', desc: 'Balanced' },
    { value: '4096', label: '4K', desc: 'Best quality' },
];

// ─── Styles ─────────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '16px',
    padding: '24px',
};

const labelStyle: React.CSSProperties = {
    fontSize: '0.8125rem',
    fontWeight: 500,
    color: 'var(--text-secondary)',
    marginBottom: '10px',
    display: 'block',
};

const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '12px 16px',
    borderRadius: '10px',
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(0,0,0,0.2)',
    color: '#fff',
    fontSize: '0.875rem',
    lineHeight: '1.5',
    resize: 'vertical' as const,
    fontFamily: 'inherit',
    outline: 'none',
};

const pillStyle = (active: boolean): React.CSSProperties => ({
    padding: '8px 14px',
    borderRadius: '10px',
    border: active ? '1.5px solid var(--accent)' : '1px solid rgba(255,255,255,0.1)',
    background: active ? 'rgba(216,180,29,0.12)' : 'rgba(0,0,0,0.2)',
    color: active ? 'var(--accent)' : 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: '0.8125rem',
    fontWeight: active ? 600 : 400,
    transition: 'all 0.2s',
    textAlign: 'center' as const,
});

const tabStyle = (active: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: '6px',
    padding: '8px 16px', borderRadius: '10px', border: 'none', cursor: 'pointer',
    fontSize: '0.8125rem', fontWeight: active ? 600 : 400,
    background: active ? 'rgba(255,255,255,0.1)' : 'transparent',
    color: active ? '#fff' : 'var(--text-muted)',
    transition: 'all 0.2s',
});

const badgeStyle: React.CSSProperties = {
    fontSize: '0.625rem',
    padding: '2px 6px',
    borderRadius: '4px',
    background: 'rgba(255,255,255,0.06)',
    color: 'var(--text-muted)',
    textTransform: 'capitalize',
};

const tagBadgeStyle: React.CSSProperties = {
    fontSize: '0.625rem',
    padding: '2px 6px',
    borderRadius: '4px',
    background: 'rgba(56,189,248,0.1)',
    color: 'rgba(56,189,248,0.8)',
};

const smallBtnStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
    padding: '6px 8px', borderRadius: '6px',
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(0,0,0,0.2)',
    color: 'var(--text-muted)',
    fontSize: '0.6875rem',
    cursor: 'pointer',
};

// ─── Platform icon helper ───────────────────────────────────────────────────

function PlatformIcon({ platform, size = 10 }: { platform: string; size?: number }) {
    const colors: Record<string, string> = { instagram: '#E1306C', facebook: '#1877F2', 'google-business': '#4285F4' };
    if (platform === 'instagram') return <Instagram size={size} style={{ color: colors[platform] }} />;
    if (platform === 'facebook') return <Facebook size={size} style={{ color: colors[platform] }} />;
    if (platform === 'google-business') return <MapPin size={size} style={{ color: colors[platform] }} />;
    return null;
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function CreativesClient() {
    const [activeTab, setActiveTab] = useState<'generate' | 'gallery'>('generate');
    const [prefillData, setPrefillData] = useState<PrefillData | null>(null);

    const handleRegenerate = (data: PrefillData) => {
        setPrefillData(data);
        setActiveTab('generate');
    };

    return (
        <div style={{ paddingBottom: '80px' }}>
            <div className="page-header">
                <h1 className="page-title">AI Creatives</h1>
                <p className="page-subtitle">Generate images for social media with AI</p>
            </div>

            {/* Nav Tabs */}
            <div style={{ display: 'inline-flex', gap: '2px', background: 'rgba(255,255,255,0.04)', padding: '4px', borderRadius: '12px', marginBottom: '24px' }}>
                <button onClick={() => setActiveTab('generate')} style={tabStyle(activeTab === 'generate')}>
                    <ImageIcon size={14} /> Generate
                </button>
                <button onClick={() => setActiveTab('gallery')} style={tabStyle(activeTab === 'gallery')}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                    Gallery
                </button>
            </div>

            {activeTab === 'generate' && <GenerateTab prefill={prefillData} onPrefillConsumed={() => setPrefillData(null)} />}
            {activeTab === 'gallery' && <GalleryTab onRegenerate={handleRegenerate} />}
        </div>
    );
}

// ─── Generate Tab ───────────────────────────────────────────────────────────

function GenerateTab({ prefill, onPrefillConsumed }: { prefill: PrefillData | null; onPrefillConsumed: () => void }) {
    const router = useRouter();
    const [prompt, setPrompt] = useState('');
    const [style, setStyle] = useState<CreativeStyle>('photorealistic');
    const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1');
    const [resolution, setResolution] = useState<Resolution>('2048');
    const [variations, setVariations] = useState<number>(1);
    const [tags, setTags] = useState<string[]>([]);
    const [tagInput, setTagInput] = useState('');
    const [referenceImages, setReferenceImages] = useState<Array<{ url: string; preview: string; isLogo: boolean }>>([]);
    const [uploading, setUploading] = useState(false);
    const refInputRef = useRef<HTMLInputElement>(null);

    const [generating, setGenerating] = useState(false);
    const [enhancedPrompt, setEnhancedPrompt] = useState<string | null>(null);
    const [showEnhanced, setShowEnhanced] = useState(false);
    const [resultUrls, setResultUrls] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [pollCount, setPollCount] = useState(0);
    const [completedCount, setCompletedCount] = useState(0);

    // Research pipeline: caption/platforms to forward to Publish
    const [researchCaption, setResearchCaption] = useState<string | null>(null);
    const [researchPlatforms, setResearchPlatforms] = useState<string[] | null>(null);

    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Brand profile state
    const [brandProfile, setBrandProfile] = useState<{ brandVoice: string; visualThemes: string[]; topTreatments: string[]; contentPillars: string[]; promptEnhancement: string; generatedAt: string; basedOnPosts: number } | null>(null);
    const [brandExpanded, setBrandExpanded] = useState(false);
    const [brandLoading, setBrandLoading] = useState(false);

    // Pre-populate logo as default reference image
    useEffect(() => {
        const logoUrl = `${window.location.origin}/logo.png`;
        setReferenceImages([{ url: logoUrl, preview: logoUrl, isLogo: true }]);
    }, []);

    // Fetch brand profile on mount
    useEffect(() => {
        fetch('/api/creatives/brand-profile')
            .then(r => r.json())
            .then(data => { if (data.profile) setBrandProfile(data.profile); })
            .catch(() => {});
    }, []);

    // Apply prefill from regenerate
    useEffect(() => {
        if (prefill) {
            setPrompt(prefill.prompt);
            setStyle(prefill.style);
            setAspectRatio(prefill.aspectRatio);
            setResolution(prefill.resolution);
            setTags(prefill.tags);
            onPrefillConsumed();
        }
    }, [prefill, onPrefillConsumed]);

    // Read Research → Creatives prefill from sessionStorage
    useEffect(() => {
        try {
            const raw = sessionStorage.getItem('research_prefill');
            if (raw) {
                const data = JSON.parse(raw);
                if (data.prompt) setPrompt(data.prompt);
                if (data.caption) setResearchCaption(data.caption);
                if (data.platforms) setResearchPlatforms(data.platforms);
                sessionStorage.removeItem('research_prefill');
            }
        } catch { /* ignore parse errors */ }
    }, []);

    // Cleanup polling on unmount
    useEffect(() => {
        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, []);

    const stopPolling = useCallback(() => {
        if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
    }, []);

    // Start polling for multiple tasks
    const startPolling = useCallback((tasks: { taskId: string; id: string }[]) => {
        stopPolling();
        let count = 0;
        const completed = new Set<string>();
        const urls: string[] = new Array(tasks.length).fill('');

        pollRef.current = setInterval(async () => {
            count++;
            setPollCount(count);
            if (count > 60) { // 60 * 5s = 300s max for variations
                stopPolling();
                setGenerating(false);
                if (urls.filter(u => u).length > 0) {
                    setResultUrls(urls.filter(u => u));
                } else {
                    setError('Generation timed out. Please try again.');
                }
                return;
            }

            for (let i = 0; i < tasks.length; i++) {
                if (completed.has(tasks[i].id)) continue;
                try {
                    const res = await fetch(`/api/creatives/generate?taskId=${tasks[i].taskId}&id=${tasks[i].id}`);
                    const data = await res.json();
                    if (data.status === 'success' && data.blobUrl) {
                        completed.add(tasks[i].id);
                        urls[i] = data.blobUrl;
                        setCompletedCount(completed.size);
                    } else if (data.status === 'failed') {
                        completed.add(tasks[i].id);
                        setCompletedCount(completed.size);
                    }
                } catch {
                    // Network error — keep polling
                }
            }

            if (completed.size === tasks.length) {
                stopPolling();
                setResultUrls(urls.filter(u => u));
                setGenerating(false);
            }
        }, 5000);
    }, [stopPolling]);

    const addTag = (t: string) => {
        const cleaned = t.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
        if (cleaned && !tags.includes(cleaned)) {
            setTags([...tags, cleaned]);
        }
        setTagInput('');
    };

    const handleGenerate = async () => {
        if (!prompt.trim()) return;
        setGenerating(true);
        setError(null);
        setResultUrls([]);
        setEnhancedPrompt(null);
        setPollCount(0);
        setCompletedCount(0);

        try {
            const res = await fetch('/api/creatives/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: prompt.trim(),
                    style,
                    aspectRatio,
                    resolution,
                    variations,
                    tags,
                    referenceImageUrls: referenceImages.filter(r => !r.isLogo).map(r => r.url).filter(Boolean),
                    includeBrandLogo: referenceImages.some(r => r.isLogo),
                }),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to start generation');

            setEnhancedPrompt(data.enhancedPrompt || data.tasks?.[0]?.enhancedPrompt);

            // Handle single or multiple tasks
            const tasks = data.tasks || [{ taskId: data.taskId, id: data.id }];
            startPolling(tasks);
        } catch (err: unknown) {
            setGenerating(false);
            setError(err instanceof Error ? err.message : 'Failed to generate');
        }
    };

    const handleRefUpload = async (file: File) => {
        if (referenceImages.length >= 3) {
            setError('Maximum 3 reference images allowed');
            return;
        }
        setUploading(true);
        try {
            const ext = file.name.split('.').pop() || 'jpg';
            const filename = `creatives/ref_${Date.now()}.${ext}`;
            const blob = await upload(filename, file, {
                access: 'public',
                handleUploadUrl: '/api/upload/token',
            });
            setReferenceImages(prev => [...prev, { url: blob.url, preview: URL.createObjectURL(file), isLogo: false }]);
        } catch {
            setError('Reference image upload failed');
        } finally {
            setUploading(false);
            if (refInputRef.current) refInputRef.current.value = '';
        }
    };

    const removeRef = (index: number) => {
        setReferenceImages(prev => {
            const img = prev[index];
            if (img && !img.isLogo) URL.revokeObjectURL(img.preview);
            return prev.filter((_, i) => i !== index);
        });
    };

    const handleSendToPublish = (url: string) => {
        // Forward Research caption/platforms to Publish via sessionStorage
        if (researchCaption || researchPlatforms) {
            sessionStorage.setItem('research_prefill', JSON.stringify({
                caption: researchCaption || undefined,
                platforms: researchPlatforms || undefined,
            }));
        }
        router.push(`/publish?mediaUrl=${encodeURIComponent(url)}`);
    };

    const handleDownload = async (url: string) => {
        try {
            const res = await fetch(url);
            const blob = await res.blob();
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = `chinup_creative_${Date.now()}.png`;
            a.click();
            URL.revokeObjectURL(blobUrl);
        } catch {
            window.open(url, '_blank');
        }
    };

    const handleReset = () => {
        setResultUrls([]);
        setEnhancedPrompt(null);
        setError(null);
        setPrompt('');
        setPollCount(0);
        setCompletedCount(0);
        setTags([]);
        setVariations(1);
        const logoUrl = `${window.location.origin}/logo.png`;
        setReferenceImages([{ url: logoUrl, preview: logoUrl, isLogo: true }]);
    };

    const refreshBrandProfile = async () => {
        setBrandLoading(true);
        try {
            const res = await fetch('/api/creatives/brand-profile', { method: 'POST' });
            const data = await res.json();
            if (data.profile) setBrandProfile(data.profile);
        } catch { /* ignore */ }
        setBrandLoading(false);
    };

    return (
        <div style={{ display: 'grid', gap: '20px', maxWidth: '720px' }}>
            {/* Brand Guidelines */}
            {brandProfile && (
                <div style={{ ...cardStyle, padding: '16px 20px' }}>
                    <button
                        onClick={() => setBrandExpanded(!brandExpanded)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fff', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 0 }}
                    >
                        <span style={{ fontSize: '0.8125rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Instagram size={14} style={{ color: '#E1306C' }} /> Brand Guidelines
                            <span style={{ fontSize: '0.625rem', fontWeight: 400, color: 'var(--text-muted)' }}>from top {brandProfile.basedOnPosts} IG posts</span>
                        </span>
                        {brandExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                    {brandExpanded && (
                        <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <div>
                                <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Brand Voice</span>
                                <p style={{ margin: '4px 0 0', fontSize: '0.8125rem', color: '#ccc', lineHeight: 1.5 }}>{brandProfile.brandVoice}</p>
                            </div>
                            <div>
                                <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Visual Themes</span>
                                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px' }}>
                                    {brandProfile.visualThemes.map((t, i) => (
                                        <span key={i} style={{ padding: '2px 8px', borderRadius: '12px', fontSize: '0.6875rem', background: 'rgba(255,255,255,0.06)', color: '#ccc' }}>{t}</span>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Content Pillars</span>
                                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px' }}>
                                    {brandProfile.contentPillars.map((p, i) => (
                                        <span key={i} style={{ padding: '2px 8px', borderRadius: '12px', fontSize: '0.6875rem', background: 'rgba(234,179,8,0.1)', color: '#eab308' }}>{p}</span>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Top Treatments</span>
                                <p style={{ margin: '4px 0 0', fontSize: '0.8125rem', color: '#ccc' }}>{brandProfile.topTreatments.join(' · ')}</p>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '4px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                                <span style={{ fontSize: '0.625rem', color: 'var(--text-muted)' }}>
                                    Auto-applied to all generations · Updated {new Date(brandProfile.generatedAt).toLocaleDateString()}
                                </span>
                                <button
                                    onClick={refreshBrandProfile}
                                    disabled={brandLoading}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.6875rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                                >
                                    <RefreshCw size={10} style={brandLoading ? { animation: 'spin 0.8s linear infinite' } : undefined} /> Refresh
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Prompt */}
            <div style={cardStyle}>
                <label style={labelStyle}>What do you want to create?</label>
                <textarea
                    value={prompt}
                    onChange={e => setPrompt(e.target.value)}
                    placeholder="e.g. A confident woman with glowing skin after a HydraFacial treatment, natural lighting, med spa setting..."
                    rows={3}
                    style={inputStyle}
                    disabled={generating}
                />
            </div>

            {/* Tags */}
            <div style={cardStyle}>
                <label style={labelStyle}>Tags (for gallery organization)</label>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                    <input
                        value={tagInput}
                        onChange={e => setTagInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(tagInput); } }}
                        placeholder="Add a tag..."
                        style={{ ...inputStyle, flex: 1, padding: '8px 12px', fontSize: '0.8125rem' }}
                        disabled={generating}
                    />
                    <button
                        onClick={() => addTag(tagInput)}
                        disabled={!tagInput.trim() || generating}
                        style={{ ...pillStyle(false), padding: '8px 16px', opacity: tagInput.trim() ? 1 : 0.5 }}
                    >
                        Add
                    </button>
                </div>
                {/* Active tags */}
                {tags.length > 0 && (
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
                        {tags.map(t => (
                            <span key={t} style={{
                                ...tagBadgeStyle,
                                display: 'flex', alignItems: 'center', gap: '4px',
                                padding: '4px 8px', fontSize: '0.75rem',
                            }}>
                                {t}
                                <button onClick={() => setTags(tags.filter(x => x !== t))} style={{
                                    background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, lineHeight: 1,
                                }}>
                                    <X size={10} />
                                </button>
                            </span>
                        ))}
                    </div>
                )}
                {/* Suggested tags */}
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    {SUGGESTED_TAGS.filter(t => !tags.includes(t)).slice(0, 8).map(t => (
                        <button
                            key={t}
                            onClick={() => addTag(t)}
                            disabled={generating}
                            style={{
                                background: 'none', border: '1px dashed rgba(255,255,255,0.1)',
                                borderRadius: '4px', padding: '2px 6px', fontSize: '0.625rem',
                                color: 'var(--text-muted)', cursor: 'pointer', opacity: 0.7,
                            }}
                        >
                            + {t}
                        </button>
                    ))}
                </div>
            </div>

            {/* Style Selector */}
            <div style={cardStyle}>
                <label style={labelStyle}>Style</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '8px' }}>
                    {STYLES.map(s => (
                        <button
                            key={s.value}
                            onClick={() => setStyle(s.value)}
                            disabled={generating}
                            style={{
                                ...pillStyle(style === s.value),
                                display: 'flex', flexDirection: 'column', gap: '2px', padding: '10px 12px',
                            }}
                        >
                            <span style={{ fontWeight: style === s.value ? 600 : 500 }}>{s.label}</span>
                            <span style={{ fontSize: '0.6875rem', opacity: 0.6 }}>{s.desc}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Aspect Ratio + Resolution */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                <div style={cardStyle}>
                    <label style={labelStyle}>Aspect Ratio</label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                        {ASPECT_RATIOS.map(ar => (
                            <button
                                key={ar.value}
                                onClick={() => setAspectRatio(ar.value)}
                                disabled={generating}
                                style={{
                                    ...pillStyle(aspectRatio === ar.value),
                                    display: 'flex', flexDirection: 'column', gap: '1px', padding: '8px 6px',
                                }}
                            >
                                <span style={{ fontWeight: aspectRatio === ar.value ? 600 : 500 }}>{ar.label}</span>
                                <span style={{ fontSize: '0.625rem', opacity: 0.6 }}>{ar.use}</span>
                            </button>
                        ))}
                    </div>
                </div>

                <div style={cardStyle}>
                    <label style={labelStyle}>Resolution</label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        {RESOLUTIONS.map(r => (
                            <button
                                key={r.value}
                                onClick={() => setResolution(r.value)}
                                disabled={generating}
                                style={{
                                    ...pillStyle(resolution === r.value),
                                    flex: 1,
                                    display: 'flex', flexDirection: 'column', gap: '1px',
                                }}
                            >
                                <span style={{ fontWeight: resolution === r.value ? 600 : 500 }}>{r.label}</span>
                                <span style={{ fontSize: '0.625rem', opacity: 0.6 }}>{r.desc}</span>
                            </button>
                        ))}
                    </div>

                    {/* Reference Images (up to 3) */}
                    <div style={{ marginTop: '16px' }}>
                        <label style={labelStyle}>Reference Images (up to 3)</label>
                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                            {referenceImages.map((img, idx) => (
                                <div key={idx} style={{ position: 'relative', display: 'inline-block' }}>
                                    <img src={img.preview} alt={img.isLogo ? 'Logo' : 'Reference'} style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }} />
                                    {img.isLogo && (
                                        <span style={{ position: 'absolute', bottom: 2, left: 2, fontSize: '0.5rem', fontWeight: 700, background: 'rgba(0,0,0,0.7)', color: 'var(--accent)', padding: '1px 4px', borderRadius: '3px' }}>LOGO</span>
                                    )}
                                    <button onClick={() => removeRef(idx)} style={{
                                        position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%',
                                        background: '#ef4444', border: 'none', color: '#fff', cursor: 'pointer',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    }}>
                                        <X size={9} />
                                    </button>
                                </div>
                            ))}
                            {referenceImages.length < 3 && (
                                <>
                                    <input type="file" ref={refInputRef} accept="image/*" onChange={e => e.target.files?.[0] && handleRefUpload(e.target.files[0])} style={{ display: 'none' }} />
                                    <button
                                        onClick={() => refInputRef.current?.click()}
                                        disabled={uploading || generating}
                                        style={{
                                            width: 64, height: 64, borderRadius: '8px', cursor: 'pointer',
                                            border: '1px dashed rgba(255,255,255,0.15)', background: 'transparent',
                                            color: 'var(--text-muted)', display: 'flex', flexDirection: 'column',
                                            alignItems: 'center', justifyContent: 'center', gap: '2px', fontSize: '0.625rem',
                                        }}
                                    >
                                        {uploading ? <Loader2 size={16} style={{ animation: 'spin 0.8s linear infinite' }} /> : <Upload size={16} />}
                                        {uploading ? '...' : 'Add'}
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Variations Selector */}
            <div style={cardStyle}>
                <label style={labelStyle}>Number of Variations</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                    {[1, 2, 3].map(n => (
                        <button
                            key={n}
                            onClick={() => setVariations(n)}
                            disabled={generating}
                            style={{
                                ...pillStyle(variations === n),
                                flex: 1,
                            }}
                        >
                            {n === 1 ? '1 Image' : `${n} Variations`}
                        </button>
                    ))}
                </div>
                {variations > 1 && (
                    <p style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '6px', opacity: 0.7 }}>
                        Each variation uses a slightly different composition. Cost: {variations}x per generation.
                    </p>
                )}
            </div>

            {/* Enhanced Prompt Preview */}
            {enhancedPrompt && (
                <div style={cardStyle}>
                    <button
                        onClick={() => setShowEnhanced(!showEnhanced)}
                        style={{
                            background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8125rem', padding: 0, width: '100%',
                        }}
                    >
                        {showEnhanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        Enhanced Prompt
                    </button>
                    {showEnhanced && (
                        <p style={{ marginTop: '8px', fontSize: '0.8125rem', color: 'var(--text-muted)', lineHeight: '1.5', fontStyle: 'italic' }}>
                            {enhancedPrompt}
                        </p>
                    )}
                </div>
            )}

            {/* Generate Button / Progress / Result */}
            {resultUrls.length === 0 && !generating && (
                <button
                    onClick={handleGenerate}
                    disabled={!prompt.trim() || generating}
                    style={{
                        width: '100%',
                        padding: '14px',
                        borderRadius: '12px',
                        border: 'none',
                        background: prompt.trim() ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
                        color: prompt.trim() ? '#000' : 'var(--text-muted)',
                        fontSize: '0.9375rem',
                        fontWeight: 600,
                        cursor: prompt.trim() ? 'pointer' : 'not-allowed',
                        transition: 'all 0.2s',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                    }}
                >
                    <ImageIcon size={18} />
                    Generate {variations === 1 ? 'Image' : `${variations} Variations`}
                </button>
            )}

            {generating && (
                <div style={{
                    ...cardStyle,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    padding: '48px 24px', gap: '16px',
                }}>
                    <Loader2 size={36} style={{ color: 'var(--accent)', animation: 'spin 1s linear infinite' }} />
                    <div style={{ textAlign: 'center' }}>
                        <p style={{ color: '#fff', fontSize: '0.9375rem', fontWeight: 500, marginBottom: '4px' }}>
                            Generating {variations > 1 ? `${completedCount}/${variations} variations` : 'your image'}...
                        </p>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
                            This usually takes 15-45 seconds ({pollCount * 5}s elapsed)
                        </p>
                    </div>
                </div>
            )}

            {error && (
                <div style={{
                    ...cardStyle,
                    borderColor: 'rgba(239,68,68,0.3)',
                    background: 'rgba(239,68,68,0.06)',
                }}>
                    <p style={{ color: '#ef4444', fontSize: '0.875rem', margin: 0 }}>{error}</p>
                    <button
                        onClick={() => { setError(null); setGenerating(false); }}
                        style={{ ...pillStyle(false), marginTop: '12px', color: 'var(--text-secondary)' }}
                    >
                        Try Again
                    </button>
                </div>
            )}

            {resultUrls.length > 0 && (
                <div style={cardStyle}>
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: resultUrls.length > 1 ? `repeat(${Math.min(resultUrls.length, 3)}, 1fr)` : '1fr',
                        gap: '12px', marginBottom: '16px',
                    }}>
                        {resultUrls.map((url, i) => (
                            <div key={i}>
                                <div style={{
                                    borderRadius: '12px', overflow: 'hidden', marginBottom: '8px',
                                    border: '1px solid rgba(255,255,255,0.08)',
                                }}>
                                    <img src={url} alt={`Generated creative ${i + 1}`} style={{ width: '100%', display: 'block' }} />
                                </div>
                                <div style={{ display: 'flex', gap: '6px' }}>
                                    <button onClick={() => handleDownload(url)} style={{ ...smallBtnStyle, flex: 1 }}>
                                        <Download size={12} /> Save
                                    </button>
                                    <button
                                        onClick={() => handleSendToPublish(url)}
                                        style={{ ...smallBtnStyle, flex: 1, background: 'rgba(216,180,29,0.15)', color: 'var(--accent)', borderColor: 'rgba(216,180,29,0.3)' }}
                                    >
                                        <Send size={12} /> Publish
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>

                    <button
                        onClick={handleReset}
                        style={{
                            ...pillStyle(false),
                            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                        }}
                    >
                        <ImageIcon size={14} /> Generate Another
                    </button>
                </div>
            )}
        </div>
    );
}

// ─── Gallery Tab ────────────────────────────────────────────────────────────

function GalleryTab({ onRegenerate }: { onRegenerate: (data: PrefillData) => void }) {
    const router = useRouter();
    const { data: session } = useSession();
    const isAdmin = (session?.user as Record<string, unknown>)?.isAdmin === true;

    const [images, setImages] = useState<GalleryImage[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeTag, setActiveTag] = useState<string | null>(null);
    const [availableTags, setAvailableTags] = useState<{ tag: string; count: number }[]>([]);
    const [selectMode, setSelectMode] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [deleting, setDeleting] = useState(false);
    const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
    const [usage, setUsage] = useState<UsageData | null>(null);

    const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const fetchImages = useCallback(async (search?: string, tag?: string) => {
        try {
            const params = new URLSearchParams();
            if (search) params.set('search', search);
            if (tag) params.set('tag', tag);
            const res = await fetch(`/api/creatives/history?${params}`);
            const data = await res.json();
            if (data.images) setImages(data.images);
        } catch {
            // Empty gallery
        }
    }, []);

    useEffect(() => {
        (async () => {
            await fetchImages();
            // Fetch tags
            try {
                const res = await fetch('/api/creatives/tags');
                const data = await res.json();
                if (data.tags) setAvailableTags(data.tags);
            } catch { /* no tags */ }
            // Fetch usage (admin only)
            if (isAdmin) {
                try {
                    const res = await fetch('/api/creatives/usage');
                    const data = await res.json();
                    setUsage(data);
                } catch { /* no usage data */ }
            }
            setLoading(false);
        })();
    }, [fetchImages, isAdmin]);

    const handleSearch = (q: string) => {
        setSearchQuery(q);
        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = setTimeout(() => {
            fetchImages(q, activeTag || undefined);
        }, 300);
    };

    const handleTagFilter = (tag: string) => {
        const newTag = activeTag === tag ? null : tag;
        setActiveTag(newTag);
        fetchImages(searchQuery || undefined, newTag || undefined);
    };

    const toggleSelect = (id: string) => {
        const next = new Set(selected);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelected(next);
    };

    const handleDelete = async (ids: string[]) => {
        if (!confirm(`Delete ${ids.length} creative${ids.length > 1 ? 's' : ''} permanently?`)) return;
        setDeleting(true);
        try {
            const res = await fetch('/api/creatives/history', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids }),
            });
            if (res.ok) {
                setImages(prev => prev.filter(img => !ids.includes(img.id)));
                setSelected(new Set());
                setSelectMode(false);
            }
        } catch {
            // Delete failed
        } finally {
            setDeleting(false);
        }
    };

    const handleRegenerate = (img: GalleryImage) => {
        onRegenerate({
            prompt: img.prompt,
            style: img.style as CreativeStyle,
            aspectRatio: img.aspectRatio as AspectRatio,
            resolution: img.resolution as Resolution,
            tags: img.tags || [],
        });
    };

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '48px' }}>
                <Loader2 size={28} style={{ color: 'var(--accent)', animation: 'spin 0.8s linear infinite' }} />
            </div>
        );
    }

    if (images.length === 0 && !searchQuery && !activeTag) {
        return (
            <div style={{
                ...cardStyle,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                padding: '64px 24px', gap: '12px',
            }}>
                <ImageIcon size={40} style={{ color: 'var(--text-muted)', opacity: 0.4 }} />
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9375rem' }}>No creatives generated yet</p>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', opacity: 0.6 }}>
                    Switch to the Generate tab to create your first image
                </p>
            </div>
        );
    }

    // Group images by group_id for variation stacking
    type GroupOrSingle = { type: 'group'; groupId: string; images: GalleryImage[] } | { type: 'single'; image: GalleryImage };
    const items: GroupOrSingle[] = [];
    const grouped = new Map<string, GalleryImage[]>();
    for (const img of images) {
        if (img.groupId) {
            if (!grouped.has(img.groupId)) grouped.set(img.groupId, []);
            grouped.get(img.groupId)!.push(img);
        } else {
            items.push({ type: 'single', image: img });
        }
    }
    for (const [groupId, imgs] of grouped) {
        // Insert group at the position of the first image
        const sortedImgs = imgs.sort((a, b) => a.variationIndex - b.variationIndex);
        items.push({ type: 'group', groupId, images: sortedImgs });
    }
    // Sort by most recent first
    items.sort((a, b) => {
        const aDate = a.type === 'single' ? a.image.createdAt : a.images[0].createdAt;
        const bDate = b.type === 'single' ? b.image.createdAt : b.images[0].createdAt;
        return new Date(bDate).getTime() - new Date(aDate).getTime();
    });

    const renderCard = (img: GalleryImage, isInGroup = false) => (
        <div key={img.id} style={{
            ...cardStyle,
            padding: 0,
            overflow: 'hidden',
            transition: 'border-color 0.2s',
            borderColor: selected.has(img.id) ? 'var(--accent)' : undefined,
            position: 'relative',
            minWidth: isInGroup ? '200px' : undefined,
        }}>
            {/* Select checkbox overlay */}
            {selectMode && (
                <button
                    onClick={() => toggleSelect(img.id)}
                    style={{
                        position: 'absolute', top: 8, left: 8, zIndex: 2,
                        background: selected.has(img.id) ? 'var(--accent)' : 'rgba(0,0,0,0.6)',
                        border: '1px solid rgba(255,255,255,0.3)', borderRadius: '4px',
                        width: 24, height: 24, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
                    }}
                >
                    {selected.has(img.id) ? <CheckSquare size={14} /> : <Square size={14} />}
                </button>
            )}
            {/* Published platforms overlay */}
            {img.publishedPlatforms && img.publishedPlatforms.length > 0 && (
                <div style={{
                    position: 'absolute', top: 8, right: 8, zIndex: 2,
                    display: 'flex', gap: '3px', background: 'rgba(0,0,0,0.7)',
                    padding: '3px 6px', borderRadius: '6px',
                }}>
                    {img.publishedPlatforms.map(p => (
                        <PlatformIcon key={p} platform={p} size={11} />
                    ))}
                </div>
            )}
            <div style={{ position: 'relative', aspectRatio: '1', overflow: 'hidden' }}>
                <img
                    src={img.blobUrl}
                    alt={img.prompt}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    onClick={() => selectMode ? toggleSelect(img.id) : undefined}
                />
            </div>
            <div style={{ padding: '12px' }}>
                <p style={{
                    fontSize: '0.8125rem', color: 'var(--text-secondary)', lineHeight: '1.4',
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const,
                    overflow: 'hidden', margin: '0 0 8px 0',
                }}>
                    {img.prompt}
                </p>
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '6px' }}>
                    <span style={badgeStyle}>{img.style}</span>
                    <span style={badgeStyle}>{img.aspectRatio}</span>
                    <span style={badgeStyle}>{img.resolution}px</span>
                </div>
                {/* Tags */}
                {img.tags && img.tags.length > 0 && (
                    <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap', marginBottom: '8px' }}>
                        {img.tags.map(t => (
                            <span key={t} style={tagBadgeStyle}>{t}</span>
                        ))}
                    </div>
                )}
                <div style={{ display: 'flex', gap: '4px' }}>
                    <button
                        onClick={() => {
                            const a = document.createElement('a');
                            a.href = img.blobUrl;
                            a.download = `chinup_creative_${img.id}.png`;
                            a.target = '_blank';
                            a.click();
                        }}
                        style={{ ...smallBtnStyle, flex: 1 }}
                    >
                        <Download size={11} /> Save
                    </button>
                    <button
                        onClick={() => router.push(`/publish?mediaUrl=${encodeURIComponent(img.blobUrl)}&creativeId=${img.id}`)}
                        style={{ ...smallBtnStyle, flex: 1, background: 'rgba(216,180,29,0.15)', color: 'var(--accent)', borderColor: 'rgba(216,180,29,0.3)' }}
                    >
                        <Send size={11} /> Publish
                    </button>
                    <button
                        onClick={() => handleRegenerate(img)}
                        style={{ ...smallBtnStyle }}
                        title="Regenerate with same settings"
                    >
                        <RefreshCw size={11} />
                    </button>
                    {!selectMode && (
                        <button
                            onClick={() => handleDelete([img.id])}
                            style={{ ...smallBtnStyle, color: 'rgba(239,68,68,0.7)' }}
                            title="Delete"
                        >
                            <Trash2 size={11} />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );

    return (
        <div>
            {/* Admin Usage Banner */}
            {isAdmin && usage && (
                <div style={{
                    ...cardStyle,
                    padding: '14px 20px',
                    marginBottom: '16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: usage.currentMonth.cost > 20 ? 'rgba(239,68,68,0.06)' : 'rgba(255,255,255,0.03)',
                    borderColor: usage.currentMonth.cost > 20 ? 'rgba(239,68,68,0.2)' : undefined,
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                            This month: <strong style={{ color: '#fff' }}>{usage.currentMonth.total}</strong> generations
                        </span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>|</span>
                        <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                            Est. cost: <strong style={{ color: usage.currentMonth.cost > 20 ? '#ef4444' : '#22c55e' }}>${usage.currentMonth.cost.toFixed(2)}</strong>
                        </span>
                    </div>
                    {usage.currentMonth.cost > 20 && (
                        <span style={{
                            fontSize: '0.6875rem', padding: '2px 8px', borderRadius: '4px',
                            background: 'rgba(239,68,68,0.15)', color: '#ef4444',
                        }}>
                            High usage
                        </span>
                    )}
                </div>
            )}

            {/* Search & Filter Bar */}
            <div style={{ marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <div style={{ flex: 1, position: 'relative' }}>
                        <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                        <input
                            value={searchQuery}
                            onChange={e => handleSearch(e.target.value)}
                            placeholder="Search prompts..."
                            style={{ ...inputStyle, paddingLeft: '34px', padding: '10px 12px 10px 34px', fontSize: '0.8125rem' }}
                        />
                    </div>
                    <button
                        onClick={() => { setSelectMode(!selectMode); setSelected(new Set()); }}
                        style={{
                            ...pillStyle(selectMode),
                            display: 'flex', alignItems: 'center', gap: '6px',
                            padding: '10px 16px',
                        }}
                    >
                        <CheckSquare size={14} />
                        {selectMode ? 'Cancel' : 'Select'}
                    </button>
                </div>
                {/* Tag filter pills */}
                {availableTags.length > 0 && (
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {availableTags.map(t => (
                            <button
                                key={t.tag}
                                onClick={() => handleTagFilter(t.tag)}
                                style={{
                                    padding: '4px 10px', borderRadius: '6px', fontSize: '0.6875rem',
                                    border: activeTag === t.tag ? '1.5px solid rgba(56,189,248,0.5)' : '1px solid rgba(255,255,255,0.08)',
                                    background: activeTag === t.tag ? 'rgba(56,189,248,0.1)' : 'transparent',
                                    color: activeTag === t.tag ? 'rgba(56,189,248,0.9)' : 'var(--text-muted)',
                                    cursor: 'pointer',
                                }}
                            >
                                {t.tag} ({t.count})
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Gallery Grid */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                gap: '16px',
            }}>
                {items.map(item => {
                    if (item.type === 'single') {
                        return renderCard(item.image);
                    }
                    // Variation group
                    const isExpanded = expandedGroup === item.groupId;
                    const first = item.images[0];
                    if (isExpanded) {
                        return (
                            <div key={item.groupId} style={{
                                gridColumn: `span ${Math.min(item.images.length, 3)}`,
                                ...cardStyle, padding: '12px',
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                        {item.images.length} variations
                                    </span>
                                    <button
                                        onClick={() => setExpandedGroup(null)}
                                        style={{ ...smallBtnStyle, fontSize: '0.625rem' }}
                                    >
                                        Collapse
                                    </button>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(item.images.length, 3)}, 1fr)`, gap: '10px' }}>
                                    {item.images.map(img => renderCard(img, true))}
                                </div>
                            </div>
                        );
                    }
                    // Collapsed group — show first image with indicator
                    return (
                        <div key={item.groupId} style={{ position: 'relative', cursor: 'pointer' }} onClick={() => setExpandedGroup(item.groupId)}>
                            {renderCard(first)}
                            <div style={{
                                position: 'absolute', bottom: 56, left: '50%', transform: 'translateX(-50%)',
                                background: 'rgba(0,0,0,0.8)', borderRadius: '12px',
                                padding: '4px 12px', fontSize: '0.6875rem', color: '#fff',
                                display: 'flex', alignItems: 'center', gap: '4px',
                            }}>
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                                1/{item.images.length}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* No results */}
            {images.length === 0 && (searchQuery || activeTag) && (
                <div style={{
                    ...cardStyle,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '48px 24px', gap: '8px',
                }}>
                    <Search size={32} style={{ color: 'var(--text-muted)', opacity: 0.4 }} />
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No results found</p>
                    <button onClick={() => { setSearchQuery(''); setActiveTag(null); fetchImages(); }} style={{ ...pillStyle(false), marginTop: '8px' }}>
                        Clear filters
                    </button>
                </div>
            )}

            {/* Floating selection action bar */}
            {selectMode && selected.size > 0 && (
                <div style={{
                    position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
                    background: 'rgba(15,15,30,0.95)', border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: '14px', padding: '12px 24px',
                    display: 'flex', alignItems: 'center', gap: '16px',
                    backdropFilter: 'blur(12px)', zIndex: 100,
                    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                }}>
                    <span style={{ fontSize: '0.875rem', color: '#fff' }}>
                        {selected.size} selected
                    </span>
                    <button
                        onClick={() => handleDelete(Array.from(selected))}
                        disabled={deleting}
                        style={{
                            padding: '8px 20px', borderRadius: '8px', border: 'none',
                            background: '#ef4444', color: '#fff', fontSize: '0.8125rem',
                            fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px',
                        }}
                    >
                        {deleting ? <Loader2 size={14} style={{ animation: 'spin 0.8s linear infinite' }} /> : <Trash2 size={14} />}
                        Delete All
                    </button>
                    <button
                        onClick={() => { setSelectMode(false); setSelected(new Set()); }}
                        style={{ ...smallBtnStyle, padding: '8px 16px', fontSize: '0.8125rem' }}
                    >
                        Cancel
                    </button>
                </div>
            )}
        </div>
    );
}
