'use client';

/**
 * Viral Outliers: watchlist of med spa / injector accounts, videos ranked by
 * views ÷ the account's median, "why it worked", Chin Up hook writer, and
 * saved collections. Loading this tab reads the database only; scraping
 * (paid) happens only when someone clicks Refresh and confirms the cost.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    selectStyle, primaryBtnStyle, smallBtnStyle, sectionLabelStyle, badgeStyle, LoadingDots, copyToClipboard,
} from './ResearchHelpers';

type Platform = 'instagram' | 'tiktok' | 'youtube';

interface Configured { apify: boolean; youtube: boolean; anthropic: boolean }
interface Account {
    id: number; platform: Platform; handle: string; display_name: string | null; category: string;
    median_views: string | null; video_count: number; last_scraped_at: string | null; last_error: string | null;
}
interface Run { platform: string; item_count: number; est_cost_usd: string; status: string; error: string | null; started_at: string }
interface Outlier {
    id: number; platform: Platform; url: string; caption: string; views: number; accountMedian: number; score: number;
    rankInAccount: number; accountVideoCount: number; durationSec: number | null; postedAt: string | null;
    thumbnailUrl: string | null; handle: string; displayName: string | null; analyzed: boolean; hasTranscript: boolean;
}
interface Analysis { hookLine: string; hookType: string; format: string; structure: string[]; whyItWorked: string; chinUpAngle: string }
interface Offer { id: string; name: string; treatment: string; aliases?: string[]; price: number; details: string; source: string; validThrough?: string }
interface HookCheck { ok: boolean; grade: number; problems: string[] }
interface HookResult { hooks: { text: string; check: HookCheck }[]; script: { hook: string; beats: string[]; cta: string; check: HookCheck } }
interface SavedItem { id: number; collection: string; kind: string; title: string; body: Record<string, unknown>; video_url: string | null; created_at: string }

const PLATFORM_LABEL: Record<Platform, string> = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube' };
const PLATFORM_COLOR: Record<Platform, string> = { instagram: '#E1306C', tiktok: '#25F4EE', youtube: '#FF0000' };
const CATEGORY_LABEL: Record<string, string> = {
    injector_creator: 'Injector / creator', medspa_brand: 'Med spa brand', atlanta_competitor: 'Atlanta competitor', other: 'Other',
};

const card: React.CSSProperties = { padding: 16 };
const inputStyle: React.CSSProperties = { ...selectStyle, cursor: 'text', minWidth: 0 };
const errorStyle: React.CSSProperties = { fontSize: '0.8125rem', color: '#EA4335', marginTop: 8 };
const mutedText: React.CSSProperties = { fontSize: '0.75rem', color: 'var(--text-muted)' };

const fmt = (n: number | string | null | undefined) =>
    n === null || n === undefined ? '-' : Number(n).toLocaleString('en-US', { notation: Number(n) >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 });

async function api<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, init);
    const text = await res.text();
    let data: Record<string, unknown> = {};
    try { data = text ? JSON.parse(text) : {}; } catch { /* non-JSON body (e.g. timeout page) */ }
    if (!res.ok) throw new Error((data.error as string) || text.slice(0, 200) || `Request failed (${res.status})`);
    return data as T;
}
const postJson = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export function ContentResearchTab() {
    const [configured, setConfigured] = useState<Configured | null>(null);
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [runs, setRuns] = useState<Run[]>([]);
    const [outliers, setOutliers] = useState<Outlier[]>([]);
    const [totalVideos, setTotalVideos] = useState(0);
    const [platformFilter, setPlatformFilter] = useState<'all' | Platform>('all');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [refreshMsg, setRefreshMsg] = useState<string | null>(null);

    const [analyses, setAnalyses] = useState<Record<number, Analysis & { note?: string | null }>>({});
    const [analyzing, setAnalyzing] = useState<number | null>(null);
    const [withTranscript, setWithTranscript] = useState(true);

    const [offers, setOffers] = useState<Offer[]>([]);
    const [offerId, setOfferId] = useState('');
    const [treatment, setTreatment] = useState('');
    const [price, setPrice] = useState('');
    const [details, setDetails] = useState('');
    const [sourceVideo, setSourceVideo] = useState<Outlier | null>(null);
    const [hookResult, setHookResult] = useState<HookResult | null>(null);
    const [hookLoading, setHookLoading] = useState(false);
    const [hookError, setHookError] = useState<string | null>(null);

    const [newPlatform, setNewPlatform] = useState<Platform>('instagram');
    const [newHandle, setNewHandle] = useState('');
    const [newCategory, setNewCategory] = useState('injector_creator');
    const [watchError, setWatchError] = useState<string | null>(null);
    const [showWatchlist, setShowWatchlist] = useState(false);

    const [saved, setSaved] = useState<SavedItem[]>([]);
    const [saveTo, setSaveTo] = useState('Winners');

    const loadAll = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [w, o, h, c] = await Promise.all([
                api<{ configured: Configured; accounts: Account[]; recentRuns: Run[] }>('/api/research/watchlist'),
                api<{ outliers: Outlier[]; totalVideos: number }>('/api/research/outliers?limit=60'),
                api<{ offers: Offer[] }>('/api/research/hooks'),
                api<{ items: SavedItem[] }>('/api/research/collections'),
            ]);
            setConfigured(w.configured);
            setAccounts(w.accounts);
            setRuns(w.recentRuns);
            setOutliers(o.outliers);
            setTotalVideos(o.totalVideos);
            setOffers(h.offers);
            setSaved(c.items);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadAll(); }, [loadAll]);

    const visibleOutliers = useMemo(
        () => outliers.filter(o => platformFilter === 'all' || o.platform === platformFilter),
        [outliers, platformFilter],
    );

    // --- Refresh (paid): ask for the plan first, then confirm the cost ---
    const refresh = async () => {
        setRefreshing(true);
        setRefreshMsg(null);
        try {
            const dry = await api<{ plan: { accounts: number; estCostUsd: number; byPlatform: Record<string, number>; skippedUnconfigured: number }; message?: string }>(
                '/api/research/outliers/refresh', postJson({}),
            );
            if (dry.message || dry.plan.accounts === 0) { setRefreshMsg(dry.message || 'Nothing to refresh.'); return; }
            const parts = Object.entries(dry.plan.byPlatform).map(([p, n]) => `${n} ${PLATFORM_LABEL[p as Platform]}`).join(', ');
            const ok = window.confirm(`Scrape ${dry.plan.accounts} accounts (${parts}), up to 20 videos each?\n\nEstimated Apify cost: about $${dry.plan.estCostUsd.toFixed(2)}. YouTube is free.`);
            if (!ok) return;
            const res = await api<{ report: { platform?: string; videos?: number; error?: string }[] }>('/api/research/outliers/refresh', postJson({ confirm: true }));
            const failed = res.report.filter(r => r.error);
            const got = res.report.reduce((s, r) => s + (r.videos || 0), 0);
            setRefreshMsg(`Saved ${got} videos.${failed.length ? ` ${failed.map(f => `${f.platform ?? 'A platform'} failed: ${f.error}`).join(' ')}` : ''}`);
            await loadAll();
        } catch (e) {
            setRefreshMsg(e instanceof Error ? e.message : String(e));
        } finally {
            setRefreshing(false);
        }
    };

    const analyze = async (o: Outlier) => {
        setAnalyzing(o.id);
        try {
            const res = await api<{ analysis: Analysis; transcriptNote?: string | null }>(`/api/research/videos/${o.id}/analyze`, postJson({ withTranscript }));
            setAnalyses(a => ({ ...a, [o.id]: { ...res.analysis, note: res.transcriptNote } }));
            setOutliers(list => list.map(x => (x.id === o.id ? { ...x, analyzed: true } : x)));
        } catch (e) {
            setAnalyses(a => ({ ...a, [o.id]: { hookLine: '', hookType: '', format: '', structure: [], whyItWorked: '', chinUpAngle: '', note: e instanceof Error ? e.message : String(e) } }));
        } finally {
            setAnalyzing(null);
        }
    };

    const pickOffer = (id: string) => {
        setOfferId(id);
        const o = offers.find(x => x.id === id);
        if (o) { setTreatment(o.treatment); setPrice(String(o.price)); setDetails(o.details); }
        else { setTreatment(''); setPrice(''); setDetails(''); }
    };
    const selectedOffer = offers.find(o => o.id === offerId);

    const writeHooks = async () => {
        setHookLoading(true);
        setHookError(null);
        setHookResult(null);
        try {
            const res = await api<HookResult>('/api/research/hooks', postJson({
                treatment, price, details, aliases: selectedOffer?.treatment === treatment ? selectedOffer?.aliases : undefined,
                videoId: sourceVideo && analyses[sourceVideo.id]?.hookLine ? sourceVideo.id : undefined,
            }));
            setHookResult(res);
        } catch (e) {
            setHookError(e instanceof Error ? e.message : String(e));
        } finally {
            setHookLoading(false);
        }
    };

    const save = async (kind: 'video' | 'hook' | 'script', title: string, body: Record<string, unknown>, videoId?: number) => {
        try {
            const res = await api<{ item: SavedItem }>('/api/research/collections', postJson({ collection: saveTo, kind, title, body, videoId }));
            setSaved(s => [res.item, ...s]);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    };
    const unsave = async (id: number) => {
        await api(`/api/research/collections?id=${id}`, { method: 'DELETE' }).catch(() => {});
        setSaved(s => s.filter(x => x.id !== id));
    };

    const addAccount = async () => {
        setWatchError(null);
        try {
            const res = await api<{ account: Account }>('/api/research/watchlist', postJson({ platform: newPlatform, handle: newHandle, category: newCategory }));
            setAccounts(a => [...a.filter(x => x.id !== res.account.id), res.account]);
            setNewHandle('');
        } catch (e) {
            setWatchError(e instanceof Error ? e.message : String(e));
        }
    };
    const removeAccount = async (a: Account) => {
        if (!window.confirm(`Remove @${a.handle}? Its saved videos go too.`)) return;
        await api(`/api/research/watchlist?id=${a.id}`, { method: 'DELETE' }).catch(e => setWatchError(String(e)));
        setAccounts(list => list.filter(x => x.id !== a.id));
        setOutliers(list => list.filter(o => o.handle !== a.handle || o.platform !== a.platform));
    };
    const loadStarter = async () => {
        setWatchError(null);
        try {
            await api('/api/research/watchlist/seed', { method: 'POST' });
            await loadAll();
            setShowWatchlist(true);
        } catch (e) {
            setWatchError(e instanceof Error ? e.message : String(e));
        }
    };

    if (loading) return <div className="section-card" style={card}><LoadingDots /></div>;

    const missing = configured ? [
        !configured.apify && 'APIFY_API_TOKEN (Instagram + TikTok scraping)',
        !configured.youtube && 'YOUTUBE_API_KEY (YouTube Shorts)',
        !configured.anthropic && 'ANTHROPIC_API_KEY ("why it worked" + hooks)',
    ].filter(Boolean) as string[] : [];
    const lastRun = runs[0];
    const collections = Array.from(new Set(saved.map(s => s.collection)));

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {error && <div className="section-card" style={{ ...card, ...errorStyle, marginTop: 0 }}>{error}</div>}

            {missing.length > 0 && (
                <div className="section-card" style={{ ...card, borderLeft: '3px solid #D8B41D' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: 4 }}>Not configured</div>
                    <div style={mutedText}>
                        Missing: {missing.join('; ')}. Those parts stay off until the key is added in Vercel. Nothing here is sample data.
                    </div>
                </div>
            )}

            {/* ---------------- Outliers ---------------- */}
            <div className="section-card" style={card}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <div style={{ flex: '1 1 220px' }}>
                        <div style={{ fontWeight: 600, fontSize: '0.9375rem' }}>Viral outliers</div>
                        <div style={mutedText}>Score = a video&apos;s views ÷ that account&apos;s median views. 10x means 10 times its usual.</div>
                    </div>
                    <select value={platformFilter} onChange={e => setPlatformFilter(e.target.value as 'all' | Platform)} style={selectStyle}>
                        <option value="all">All platforms</option>
                        <option value="instagram">Instagram</option>
                        <option value="tiktok">TikTok</option>
                        <option value="youtube">YouTube</option>
                    </select>
                    <button
                        onClick={refresh}
                        disabled={refreshing || !configured || (!configured.apify && !configured.youtube) || accounts.length === 0}
                        style={{ ...primaryBtnStyle, opacity: refreshing ? 0.6 : 1 }}
                        title="Shows the estimated cost before anything runs"
                    >
                        {refreshing ? 'Refreshing...' : 'Refresh videos'}
                    </button>
                </div>
                <div style={{ ...mutedText, marginBottom: 12 }}>
                    Refresh scrapes up to 20 accounts not checked in 7 days, 20 videos each, and asks before spending (about $0.05 per Instagram/TikTok account).
                    {lastRun && <> Last run: {new Date(lastRun.started_at).toLocaleString()} ({lastRun.status}, {lastRun.item_count} videos, est. ${Number(lastRun.est_cost_usd).toFixed(2)}).</>}
                </div>
                {refreshMsg && <div style={{ fontSize: '0.8125rem', marginBottom: 12 }}>{refreshMsg}</div>}

                <label style={{ ...mutedText, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                    <input type="checkbox" checked={withTranscript} onChange={e => setWithTranscript(e.target.checked)} />
                    Pull the transcript when analyzing (Instagram ~$0.03, TikTok ~$0.01, paid once per video)
                </label>

                {accounts.length === 0 ? (
                    <div style={mutedText}>No accounts yet. Add some below or load the starter list.</div>
                ) : visibleOutliers.length === 0 ? (
                    <div style={mutedText}>
                        {totalVideos === 0
                            ? 'No videos scraped yet. Click Refresh videos to pull them.'
                            : 'No outliers yet. An account needs at least 5 videos with views before it gets a score.'}
                    </div>
                ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', gap: 12 }}>
                        {visibleOutliers.map(o => {
                            const a = analyses[o.id];
                            return (
                                <div key={o.id} style={{ border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                                        <span style={{ fontSize: '1.375rem', fontWeight: 700, color: 'var(--accent-primary)' }}>{o.score}x</span>
                                        <span style={mutedText}>{fmt(o.views)} views vs {fmt(o.accountMedian)} usual</span>
                                    </div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                                        <span style={badgeStyle(PLATFORM_COLOR[o.platform])}>{PLATFORM_LABEL[o.platform]}</span>
                                        <span style={{ fontSize: '0.8125rem', fontWeight: 600 }}>@{o.handle}</span>
                                        <span style={mutedText}>#{o.rankInAccount} of {o.accountVideoCount}</span>
                                    </div>
                                    <div style={{ fontSize: '0.8125rem', color: 'var(--text-primary)', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
                                        {o.caption || <span style={mutedText}>(no caption)</span>}
                                    </div>
                                    {o.postedAt && <div style={mutedText}>{new Date(o.postedAt).toLocaleDateString()}{o.durationSec ? ` · ${o.durationSec}s` : ''}</div>}

                                    {a && (
                                        <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: 10, fontSize: '0.8125rem', display: 'flex', flexDirection: 'column', gap: 6 }}>
                                            {a.hookLine && <div><b>Hook:</b> &ldquo;{a.hookLine}&rdquo; <span style={badgeStyle('#888')}>{a.hookType.replace(/_/g, ' ')}</span> <span style={badgeStyle('#888')}>{a.format.replace(/_/g, ' ')}</span></div>}
                                            {a.structure.length > 0 && <div><b>Beats:</b> {a.structure.join(' → ')}</div>}
                                            {a.whyItWorked && <div><b>Why it worked:</b> {a.whyItWorked}</div>}
                                            {a.chinUpAngle && <div><b>For Chin Up:</b> {a.chinUpAngle}</div>}
                                            {a.note && <div style={mutedText}>{a.note}</div>}
                                        </div>
                                    )}

                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 'auto' }}>
                                        <a href={o.url} target="_blank" rel="noreferrer" style={{ ...smallBtnStyle, textDecoration: 'none' }}>Open</a>
                                        <button style={smallBtnStyle} disabled={analyzing === o.id || (!configured?.anthropic && !o.analyzed)} onClick={() => analyze(o)}>
                                            {analyzing === o.id ? 'Analyzing...' : a?.hookLine ? 'Analyzed' : 'Why it worked'}
                                        </button>
                                        <button style={smallBtnStyle} onClick={() => { setSourceVideo(o); document.getElementById('hook-writer')?.scrollIntoView({ behavior: 'smooth' }); }}>
                                            Use for hooks
                                        </button>
                                        <button style={smallBtnStyle} onClick={() => save('video', `@${o.handle}: ${o.caption.slice(0, 80) || o.url}`, { score: o.score, views: o.views, url: o.url, analysis: a ?? null }, o.id)}>
                                            Save
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* ---------------- Hook writer ---------------- */}
            <div id="hook-writer" className="section-card" style={card}>
                <div style={{ fontWeight: 600, fontSize: '0.9375rem' }}>Hooks for Chin Up offers</div>
                <div style={{ ...mutedText, marginBottom: 12 }}>
                    Clear over clever: every hook says the treatment and the exact price, at a 5th-grade reading level. Prices come from the wiki; confirm them in Zenoti before posting.
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: 10 }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={sectionLabelStyle}>Offer</span>
                        <select value={offerId} onChange={e => pickOffer(e.target.value)} style={selectStyle}>
                            <option value="">Custom (type it in)</option>
                            {offers.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                        </select>
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={sectionLabelStyle}>Treatment</span>
                        <input value={treatment} onChange={e => setTreatment(e.target.value)} placeholder="Botox" style={inputStyle} />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={sectionLabelStyle}>Price (required)</span>
                        <input value={price} onChange={e => setPrice(e.target.value)} placeholder="$199" inputMode="decimal" style={inputStyle} />
                    </label>
                </div>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10 }}>
                    <span style={sectionLabelStyle}>What they get (optional)</span>
                    <input value={details} onChange={e => setDetails(e.target.value)} placeholder="60 units, about 2 areas" style={inputStyle} />
                </label>
                {selectedOffer && (
                    <div style={{ ...mutedText, marginTop: 8 }}>
                        Source: {selectedOffer.source}{selectedOffer.validThrough ? `. Runs through ${selectedOffer.validThrough}` : ''}. Confirm in Zenoti.
                    </div>
                )}
                {sourceVideo && (
                    <div style={{ ...mutedText, marginTop: 8 }}>
                        Modeled on @{sourceVideo.handle} ({sourceVideo.score}x){analyses[sourceVideo.id]?.hookLine ? '' : ': run "Why it worked" on it first to borrow its shape'}.{' '}
                        <button style={{ ...smallBtnStyle, padding: '2px 8px' }} onClick={() => setSourceVideo(null)}>Clear</button>
                    </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                    <button onClick={writeHooks} disabled={hookLoading || !treatment.trim() || !price.trim() || !configured?.anthropic} style={{ ...primaryBtnStyle, opacity: hookLoading ? 0.6 : 1 }}>
                        {hookLoading ? 'Writing...' : 'Write hooks'}
                    </button>
                    {!price.trim() && <span style={mutedText}>Enter the real price first. We never guess one.</span>}
                </div>
                {hookError && <div style={errorStyle}>{hookError}</div>}

                {hookResult && (
                    <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={sectionLabelStyle}>Hooks</div>
                        {hookResult.hooks.map((h, i) => (
                            <div key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: '8px 10px', border: '1px solid var(--border-subtle)', borderRadius: 8 }}>
                                <span style={badgeStyle(h.check.ok ? '#34A853' : '#EA4335')}>{h.check.ok ? 'Pass' : 'Fix'}</span>
                                <span style={{ flex: '1 1 200px', fontSize: '0.875rem' }}>{h.text}</span>
                                <span style={mutedText}>grade {h.check.grade}</span>
                                <button style={smallBtnStyle} onClick={() => copyToClipboard(h.text)}>Copy</button>
                                <button style={smallBtnStyle} onClick={() => save('hook', h.text, { treatment, price, check: h.check }, sourceVideo?.id)}>Save</button>
                                {h.check.problems.length > 0 && <div style={{ ...mutedText, width: '100%' }}>{h.check.problems.join(' ')}</div>}
                            </div>
                        ))}
                        <div style={{ ...sectionLabelStyle, marginTop: 8 }}>Script</div>
                        <div style={{ padding: 12, border: '1px solid var(--border-subtle)', borderRadius: 8, fontSize: '0.875rem', display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <div><b>Hook:</b> {hookResult.script.hook} {!hookResult.script.check.ok && <span style={{ ...mutedText, color: '#EA4335' }}>({hookResult.script.check.problems.join(' ')})</span>}</div>
                            <ol style={{ margin: 0, paddingLeft: 20 }}>{hookResult.script.beats.map((b, i) => <li key={i}>{b}</li>)}</ol>
                            <div><b>CTA:</b> {hookResult.script.cta}</div>
                            <div style={{ display: 'flex', gap: 6 }}>
                                <button style={smallBtnStyle} onClick={() => copyToClipboard([hookResult.script.hook, ...hookResult.script.beats, hookResult.script.cta].join('\n'))}>Copy</button>
                                <button style={smallBtnStyle} onClick={() => save('script', hookResult.script.hook, { ...hookResult.script, treatment, price }, sourceVideo?.id)}>Save</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* ---------------- Collections ---------------- */}
            <div className="section-card" style={card}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.9375rem', flex: '1 1 160px' }}>Collections</div>
                    <label style={{ ...mutedText, display: 'flex', alignItems: 'center', gap: 6 }}>
                        Save to
                        <input value={saveTo} onChange={e => setSaveTo(e.target.value)} list="research-collections" style={{ ...inputStyle, width: 160 }} />
                        <datalist id="research-collections">{collections.map(c => <option key={c} value={c} />)}</datalist>
                    </label>
                </div>
                {saved.length === 0 ? (
                    <div style={mutedText}>Nothing saved yet. Use Save on a video, hook or script.</div>
                ) : collections.map(c => (
                    <div key={c} style={{ marginBottom: 12 }}>
                        <div style={sectionLabelStyle}>{c}</div>
                        {saved.filter(s => s.collection === c).map(s => (
                            <div key={s.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: '0.8125rem' }}>
                                <span style={badgeStyle('#888')}>{s.kind}</span>
                                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {s.video_url ? <a href={s.video_url} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>{s.title}</a> : s.title}
                                </span>
                                <button style={{ ...smallBtnStyle, padding: '2px 8px' }} onClick={() => copyToClipboard(s.title)}>Copy</button>
                                <button style={{ ...smallBtnStyle, padding: '2px 8px' }} onClick={() => unsave(s.id)} aria-label="Remove">×</button>
                            </div>
                        ))}
                    </div>
                ))}
            </div>

            {/* ---------------- Watchlist ---------------- */}
            <div className="section-card" style={card}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.9375rem', flex: '1 1 160px' }}>
                        Watchlist <span style={mutedText}>({accounts.length} accounts)</span>
                    </div>
                    {accounts.length === 0 && <button style={primaryBtnStyle} onClick={loadStarter}>Load starter list (60 accounts)</button>}
                    <button style={smallBtnStyle} onClick={() => setShowWatchlist(s => !s)}>{showWatchlist ? 'Hide' : 'Manage'}</button>
                </div>
                {watchError && <div style={errorStyle}>{watchError}</div>}
                {showWatchlist && (
                    <>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '12px 0' }}>
                            <select value={newPlatform} onChange={e => setNewPlatform(e.target.value as Platform)} style={selectStyle}>
                                <option value="instagram">Instagram</option>
                                <option value="tiktok">TikTok</option>
                                <option value="youtube">YouTube</option>
                            </select>
                            <input value={newHandle} onChange={e => setNewHandle(e.target.value)} onKeyDown={e => e.key === 'Enter' && addAccount()}
                                placeholder="@handle or profile link" style={{ ...inputStyle, flex: '1 1 180px' }} />
                            <select value={newCategory} onChange={e => setNewCategory(e.target.value)} style={selectStyle}>
                                {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                            </select>
                            <button style={primaryBtnStyle} onClick={addAccount} disabled={!newHandle.trim()}>Add</button>
                        </div>
                        {(['instagram', 'tiktok', 'youtube'] as Platform[]).map(p => {
                            const list = accounts.filter(a => a.platform === p);
                            if (list.length === 0) return null;
                            return (
                                <div key={p} style={{ marginBottom: 12 }}>
                                    <div style={sectionLabelStyle}>{PLATFORM_LABEL[p]} ({list.length})</div>
                                    {list.map(a => (
                                        <div key={a.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: '0.8125rem' }}>
                                            <span style={{ fontWeight: 600, minWidth: 140 }}>@{a.handle}</span>
                                            <span style={badgeStyle('#888')}>{CATEGORY_LABEL[a.category] ?? a.category}</span>
                                            <span style={{ ...mutedText, flex: 1 }}>
                                                {a.last_scraped_at ? `median ${fmt(a.median_views)} · ${a.video_count} videos · ${new Date(a.last_scraped_at).toLocaleDateString()}` : 'not scraped yet'}
                                                {a.last_error && <span style={{ color: '#EA4335' }}> · {a.last_error}</span>}
                                            </span>
                                            <button style={{ ...smallBtnStyle, padding: '2px 8px' }} onClick={() => removeAccount(a)} aria-label={`Remove @${a.handle}`}>×</button>
                                        </div>
                                    ))}
                                </div>
                            );
                        })}
                    </>
                )}
            </div>
        </div>
    );
}
