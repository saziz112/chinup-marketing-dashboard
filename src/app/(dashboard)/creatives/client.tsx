'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { upload } from '@vercel/blob/client';
import { Loader2, Download, Send, Image as ImageIcon, Upload, X, ChevronDown, ChevronUp } from 'lucide-react';
import { useRouter } from 'next/navigation';

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
}

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

// ─── Main Component ─────────────────────────────────────────────────────────

export default function CreativesClient() {
    const [activeTab, setActiveTab] = useState<'generate' | 'gallery'>('generate');

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

            {activeTab === 'generate' && <GenerateTab />}
            {activeTab === 'gallery' && <GalleryTab />}
        </div>
    );
}

// ─── Generate Tab ───────────────────────────────────────────────────────────

function GenerateTab() {
    const router = useRouter();
    const [prompt, setPrompt] = useState('');
    const [style, setStyle] = useState<CreativeStyle>('photorealistic');
    const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1');
    const [resolution, setResolution] = useState<Resolution>('2048');
    const [referenceUrl, setReferenceUrl] = useState('');
    const [refPreview, setRefPreview] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);
    const refInputRef = useRef<HTMLInputElement>(null);

    const [generating, setGenerating] = useState(false);
    const [taskId, setTaskId] = useState<string | null>(null);
    const [recordId, setRecordId] = useState<string | null>(null);
    const [enhancedPrompt, setEnhancedPrompt] = useState<string | null>(null);
    const [showEnhanced, setShowEnhanced] = useState(false);
    const [resultUrl, setResultUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [pollCount, setPollCount] = useState(0);

    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

    // Start polling
    const startPolling = useCallback((tId: string, rId: string) => {
        stopPolling();
        let count = 0;
        pollRef.current = setInterval(async () => {
            count++;
            setPollCount(count);
            if (count > 36) { // 36 * 5s = 180s max
                stopPolling();
                setGenerating(false);
                setError('Generation timed out. Please try again.');
                return;
            }

            try {
                const res = await fetch(`/api/creatives/generate?taskId=${tId}&id=${rId}`);
                const data = await res.json();

                if (data.status === 'success' && data.blobUrl) {
                    stopPolling();
                    setResultUrl(data.blobUrl);
                    setGenerating(false);
                } else if (data.status === 'failed') {
                    stopPolling();
                    setGenerating(false);
                    setError(data.error || 'Generation failed');
                }
            } catch {
                // Network error — keep polling
            }
        }, 5000);
    }, [stopPolling]);

    const handleGenerate = async () => {
        if (!prompt.trim()) return;
        setGenerating(true);
        setError(null);
        setResultUrl(null);
        setEnhancedPrompt(null);
        setPollCount(0);

        try {
            const res = await fetch('/api/creatives/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: prompt.trim(),
                    style,
                    aspectRatio,
                    resolution,
                    referenceImageUrl: referenceUrl || undefined,
                }),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to start generation');

            setTaskId(data.taskId);
            setRecordId(data.id);
            setEnhancedPrompt(data.enhancedPrompt);
            startPolling(data.taskId, data.id);
        } catch (err: unknown) {
            setGenerating(false);
            setError(err instanceof Error ? err.message : 'Failed to generate');
        }
    };

    const handleRefUpload = async (file: File) => {
        setUploading(true);
        try {
            const ext = file.name.split('.').pop() || 'jpg';
            const filename = `creatives/ref_${Date.now()}.${ext}`;
            const blob = await upload(filename, file, {
                access: 'public',
                handleUploadUrl: '/api/upload/token',
            });
            setReferenceUrl(blob.url);
            setRefPreview(URL.createObjectURL(file));
        } catch {
            setError('Reference image upload failed');
        } finally {
            setUploading(false);
        }
    };

    const clearRef = () => {
        if (refPreview) URL.revokeObjectURL(refPreview);
        setReferenceUrl('');
        setRefPreview(null);
        if (refInputRef.current) refInputRef.current.value = '';
    };

    const handleSendToPublish = () => {
        if (resultUrl) {
            router.push(`/publish?mediaUrl=${encodeURIComponent(resultUrl)}`);
        }
    };

    const handleDownload = async () => {
        if (!resultUrl) return;
        try {
            const res = await fetch(resultUrl);
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `chinup_creative_${Date.now()}.png`;
            a.click();
            URL.revokeObjectURL(url);
        } catch {
            window.open(resultUrl, '_blank');
        }
    };

    const handleReset = () => {
        setResultUrl(null);
        setTaskId(null);
        setRecordId(null);
        setEnhancedPrompt(null);
        setError(null);
        setPrompt('');
        setPollCount(0);
    };

    return (
        <div style={{ display: 'grid', gap: '20px', maxWidth: '720px' }}>
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

                    {/* Reference Image */}
                    <div style={{ marginTop: '16px' }}>
                        <label style={labelStyle}>Reference Image (optional)</label>
                        {refPreview ? (
                            <div style={{ position: 'relative', display: 'inline-block' }}>
                                <img src={refPreview} alt="Reference" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }} />
                                <button onClick={clearRef} style={{
                                    position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%',
                                    background: '#ef4444', border: 'none', color: '#fff', cursor: 'pointer',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px',
                                }}>
                                    <X size={10} />
                                </button>
                            </div>
                        ) : (
                            <>
                                <input type="file" ref={refInputRef} accept="image/*" onChange={e => e.target.files?.[0] && handleRefUpload(e.target.files[0])} style={{ display: 'none' }} />
                                <button
                                    onClick={() => refInputRef.current?.click()}
                                    disabled={uploading || generating}
                                    style={{
                                        ...pillStyle(false),
                                        display: 'flex', alignItems: 'center', gap: '6px', width: '100%', justifyContent: 'center',
                                    }}
                                >
                                    {uploading ? <Loader2 size={14} style={{ animation: 'spin 0.8s linear infinite' }} /> : <Upload size={14} />}
                                    {uploading ? 'Uploading...' : 'Upload'}
                                </button>
                            </>
                        )}
                    </div>
                </div>
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
            {!resultUrl && !generating && (
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
                    Generate Image
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
                            Generating your image...
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

            {resultUrl && (
                <div style={cardStyle}>
                    <div style={{
                        borderRadius: '12px', overflow: 'hidden', marginBottom: '16px',
                        border: '1px solid rgba(255,255,255,0.08)',
                    }}>
                        <img
                            src={resultUrl}
                            alt="Generated creative"
                            style={{ width: '100%', display: 'block' }}
                        />
                    </div>

                    <div style={{ display: 'flex', gap: '10px' }}>
                        <button
                            onClick={handleDownload}
                            style={{
                                ...pillStyle(false),
                                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                                padding: '12px',
                            }}
                        >
                            <Download size={16} /> Download
                        </button>
                        <button
                            onClick={handleSendToPublish}
                            style={{
                                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                                padding: '12px', borderRadius: '10px', border: 'none',
                                background: 'var(--accent)', color: '#000',
                                fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer',
                            }}
                        >
                            <Send size={16} /> Send to Publish
                        </button>
                    </div>

                    <button
                        onClick={handleReset}
                        style={{
                            ...pillStyle(false),
                            width: '100%', marginTop: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
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

function GalleryTab() {
    const router = useRouter();
    const [images, setImages] = useState<GalleryImage[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch('/api/creatives/history');
                const data = await res.json();
                if (data.images) setImages(data.images);
            } catch {
                // Empty gallery
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '48px' }}>
                <Loader2 size={28} style={{ color: 'var(--accent)', animation: 'spin 0.8s linear infinite' }} />
            </div>
        );
    }

    if (images.length === 0) {
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

    return (
        <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: '16px',
        }}>
            {images.map(img => (
                <div key={img.id} style={{
                    ...cardStyle,
                    padding: 0,
                    overflow: 'hidden',
                    transition: 'border-color 0.2s',
                }}>
                    <div style={{ position: 'relative', aspectRatio: '1', overflow: 'hidden' }}>
                        <img
                            src={img.blobUrl}
                            alt={img.prompt}
                            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
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
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '10px' }}>
                            <span style={badgeStyle}>{img.style}</span>
                            <span style={badgeStyle}>{img.aspectRatio}</span>
                            <span style={badgeStyle}>{img.resolution}px</span>
                        </div>
                        <div style={{ display: 'flex', gap: '6px' }}>
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
                                <Download size={12} /> Save
                            </button>
                            <button
                                onClick={() => router.push(`/publish?mediaUrl=${encodeURIComponent(img.blobUrl)}`)}
                                style={{ ...smallBtnStyle, flex: 1, background: 'rgba(216,180,29,0.15)', color: 'var(--accent)', borderColor: 'rgba(216,180,29,0.3)' }}
                            >
                                <Send size={12} /> Publish
                            </button>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}

const badgeStyle: React.CSSProperties = {
    fontSize: '0.625rem',
    padding: '2px 6px',
    borderRadius: '4px',
    background: 'rgba(255,255,255,0.06)',
    color: 'var(--text-muted)',
    textTransform: 'capitalize',
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
