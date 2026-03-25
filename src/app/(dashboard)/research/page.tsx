'use client';

import { useSession } from 'next-auth/react';
import { useState, useMemo, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

type ResearchTab = 'Trend Scout' | 'Content Calendar' | 'Market Intel';

const TABS: ResearchTab[] = ['Trend Scout', 'Content Calendar', 'Market Intel'];
const FOCUS_OPTIONS = [
    { value: 'all', label: 'All Topics' },
    { value: 'treatments', label: 'Treatments' },
    { value: 'promotions', label: 'Promotions' },
    { value: 'educational', label: 'Educational' },
    { value: 'lifestyle', label: 'Lifestyle' },
];

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

const CATEGORY_COLORS: Record<string, string> = {
    treatment: '#E130A4',
    promotion: '#D8B41D',
    educational: '#4285F4',
    lifestyle: '#34A853',
};

interface TrendTopic {
    title: string;
    platform: string;
    format: string;
    rationale: string;
    potential: 'High' | 'Medium' | 'Low';
    category: string;
}

interface CalendarDay {
    date: string;
    topic: string;
    platform: string;
    format: string;
    caption: string;
    hashtags: string;
    category: string;
}

interface SocialTrendIG {
    hashtag: string;
    posts: Array<{
        id: string;
        caption: string;
        likeCount: number;
        commentsCount: number;
        mediaType: string;
        permalink: string;
        timestamp: string;
    }>;
}

interface SocialTrendYT {
    query: string;
    videos: Array<{
        id: string;
        title: string;
        channelTitle: string;
        viewCount: number;
        likeCount: number;
        publishedAt: string;
        thumbnailUrl: string;
    }>;
}

interface MarketData {
    topPosts: Array<{ title: string; platform: string; engagementRate: number; views: number }>;
    bestTimes: Array<{ hour: number; avgEngagement: number }>;
    topSources: Array<{ source: string; count: number; trend: 'up' | 'down' | 'flat' }>;
    topTreatments: Array<{ name: string; count: number }>;
    searchQueries: Array<{ query: string; clicks: number; impressions: number; position: number }>;
    promotionIdeas: Array<{ name: string; offer: string; audience: string; angle: string }>;
}

const VIDEO_FORMATS = ['reel', 'story', 'video', 'short', 'youtube video', 'youtube short', 'tiktok'];
function isVideoFormat(format: string): boolean {
    return VIDEO_FORMATS.some(v => format.toLowerCase().includes(v));
}

export default function ResearchPage() {
    const { data: session } = useSession();
    const router = useRouter();
    const [activeTab, setActiveTab] = useState<ResearchTab>('Trend Scout');

    // Shared month/year state
    const now = new Date();
    const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 2 > 12 ? 1 : now.getMonth() + 2); // default to next month
    const [selectedYear, setSelectedYear] = useState(now.getMonth() + 2 > 12 ? now.getFullYear() + 1 : now.getFullYear());

    // --- Trend Scout state ---
    const [trendFocus, setTrendFocus] = useState('all');
    const [trends, setTrends] = useState<TrendTopic[]>([]);
    const [trendLoading, setTrendLoading] = useState(false);
    const [trendLastGenerated, setTrendLastGenerated] = useState<string | null>(null);
    const [trendError, setTrendError] = useState<string | null>(null);

    // --- Content Calendar state ---
    const [calendarDays, setCalendarDays] = useState<CalendarDay[]>([]);
    const [calendarLoading, setCalendarLoading] = useState(false);
    const [calendarLastGenerated, setCalendarLastGenerated] = useState<string | null>(null);
    const [calendarError, setCalendarError] = useState<string | null>(null);
    const [expandedDay, setExpandedDay] = useState<string | null>(null);

    // --- Market Intel state ---
    const [igTrends, setIgTrends] = useState<SocialTrendIG[]>([]);
    const [ytTrends, setYtTrends] = useState<SocialTrendYT[]>([]);
    const [tiktokSummary, setTiktokSummary] = useState<string | null>(null);
    const [tiktokTrends, setTiktokTrends] = useState<Array<{ title: string; description: string }>>([]);
    const [marketData, setMarketData] = useState<MarketData | null>(null);
    const [igLoading, setIgLoading] = useState(false);
    const [ytLoading, setYtLoading] = useState(false);
    const [tiktokLoading, setTiktokLoading] = useState(false);
    const [marketLoading, setMarketLoading] = useState(false);
    const [marketFetched, setMarketFetched] = useState(false);

    // --- Calendar Queue state ---
    const [queueLoading, setQueueLoading] = useState(false);
    const [queueResult, setQueueResult] = useState<{ created: number; failed: number; replaced: number } | null>(null);
    const [calendarLoadingFromDB, setCalendarLoadingFromDB] = useState(false);

    // --- Calendar Persistence: auto-load saved calendar on tab switch / month change ---
    const loadSavedCalendar = useCallback(async (m: number, y: number) => {
        setCalendarLoadingFromDB(true);
        try {
            const res = await fetch(`/api/research/calendar?month=${m}&year=${y}`);
            const data = await res.json();
            if (data.saved && data.days?.length) {
                setCalendarDays(data.days);
                const dt = new Date(data.createdAt);
                setCalendarLastGenerated(dt.toLocaleDateString() + ' ' + dt.toLocaleTimeString());
            }
        } catch { /* no saved calendar */ }
        setCalendarLoadingFromDB(false);
    }, []);

    useEffect(() => {
        if (activeTab === 'Content Calendar' && calendarDays.length === 0) {
            loadSavedCalendar(selectedMonth, selectedYear);
        }
    }, [activeTab, selectedMonth, selectedYear, loadSavedCalendar]); // eslint-disable-line react-hooks/exhaustive-deps

    // --- Trend Scout ---
    const generateTrends = async () => {
        setTrendLoading(true);
        setTrendError(null);
        try {
            const res = await fetch('/api/research/trends', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ month: selectedMonth, year: selectedYear, focus: trendFocus }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to generate trends');
            setTrends(data.topics || []);
            setTrendLastGenerated(new Date().toLocaleTimeString());
        } catch (e: any) {
            setTrendError(e.message);
        } finally {
            setTrendLoading(false);
        }
    };

    // --- Content Calendar ---
    const generateCalendar = async () => {
        setCalendarLoading(true);
        setCalendarError(null);
        try {
            const res = await fetch('/api/research/calendar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    month: selectedMonth,
                    year: selectedYear,
                    savedTopics: trends.length > 0 ? trends.map(t => t.title) : undefined,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to generate calendar');
            setCalendarDays(data.days || []);
            setCalendarLastGenerated(new Date().toLocaleTimeString());
        } catch (e: any) {
            setCalendarError(e.message);
        } finally {
            setCalendarLoading(false);
        }
    };

    // --- Market Intel ---
    const fetchMarketIntel = async () => {
        setMarketFetched(true);
        // Fetch all 4 sources in parallel
        setIgLoading(true);
        setYtLoading(true);
        setTiktokLoading(true);
        setMarketLoading(true);

        // IG hashtag trends
        fetch('/api/research/social-trends?source=instagram')
            .then(r => r.json())
            .then(d => { setIgTrends(d.results || []); })
            .catch(() => {})
            .finally(() => setIgLoading(false));

        // YT search trends
        fetch('/api/research/social-trends?source=youtube')
            .then(r => r.json())
            .then(d => { setYtTrends(d.results || []); })
            .catch(() => {})
            .finally(() => setYtLoading(false));

        // TikTok AI analysis
        fetch('/api/research/social-trends?source=tiktok')
            .then(r => r.json())
            .then(d => {
                setTiktokSummary(d.summary || null);
                setTiktokTrends(d.trends || []);
            })
            .catch(() => {})
            .finally(() => setTiktokLoading(false));

        // Internal data
        fetch(`/api/research/market?month=${selectedMonth}&year=${selectedYear}`)
            .then(r => r.json())
            .then(d => { setMarketData(d); })
            .catch(() => {})
            .finally(() => setMarketLoading(false));
    };

    // --- Month Navigation ---
    const goMonth = (delta: number) => {
        let m = selectedMonth + delta;
        let y = selectedYear;
        if (m > 12) { m = 1; y++; }
        if (m < 1) { m = 12; y--; }
        setSelectedMonth(m);
        setSelectedYear(y);
    };

    // --- Calendar Grid Helpers ---
    const calendarGrid = useMemo(() => {
        if (calendarDays.length === 0) return [];
        const firstDay = new Date(selectedYear, selectedMonth - 1, 1).getDay(); // 0=Sun
        const daysInMonth = new Date(selectedYear, selectedMonth, 0).getDate();
        const grid: (CalendarDay | null)[] = [];

        // Pad start
        for (let i = 0; i < firstDay; i++) grid.push(null);
        // Fill days
        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const dayData = calendarDays.find(cd => cd.date === dateStr);
            grid.push(dayData || null);
        }
        return grid;
    }, [calendarDays, selectedMonth, selectedYear]);

    // --- Calendar Summary ---
    const calendarSummary = useMemo(() => {
        if (calendarDays.length === 0) return null;
        const byPlatform: Record<string, number> = {};
        const byCategory: Record<string, number> = {};
        for (const d of calendarDays) {
            byPlatform[d.platform] = (byPlatform[d.platform] || 0) + 1;
            byCategory[d.category] = (byCategory[d.category] || 0) + 1;
        }
        return { byPlatform, byCategory, total: calendarDays.length };
    }, [calendarDays]);

    if (!session) return null;

    // ================================================================
    //  RENDER: Trend Scout Tab
    // ================================================================
    const renderTrendScout = () => (
        <div>
            {/* Config bar */}
            <div className="section-card" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Month:</label>
                    <select
                        value={selectedMonth}
                        onChange={e => setSelectedMonth(Number(e.target.value))}
                        style={selectStyle}
                    >
                        {MONTH_NAMES.map((m, i) => (
                            <option key={i} value={i + 1}>{m}</option>
                        ))}
                    </select>
                    <select
                        value={selectedYear}
                        onChange={e => setSelectedYear(Number(e.target.value))}
                        style={selectStyle}
                    >
                        <option value={2026}>2026</option>
                        <option value={2027}>2027</option>
                    </select>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Focus:</label>
                    <select value={trendFocus} onChange={e => setTrendFocus(e.target.value)} style={selectStyle}>
                        {FOCUS_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </select>
                </div>

                <button
                    onClick={generateTrends}
                    disabled={trendLoading}
                    style={primaryBtnStyle}
                >
                    {trendLoading ? 'Generating...' : 'Generate Ideas'}
                </button>

                {trendLastGenerated && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        Last generated: {trendLastGenerated}
                    </span>
                )}
            </div>

            {trendError && (
                <div style={{ color: 'var(--danger)', padding: '12px 0', fontSize: '0.875rem' }}>
                    {trendError}
                </div>
            )}

            {/* Results Grid */}
            {trends.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16, marginTop: 16 }}>
                    {trends.map((topic, i) => (
                        <div key={i} className="section-card" style={{ marginBottom: 0 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                                <h4 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0, lineHeight: 1.3, flex: 1 }}>
                                    {topic.title}
                                </h4>
                                <span style={{
                                    fontSize: '0.6875rem',
                                    fontWeight: 600,
                                    padding: '2px 8px',
                                    borderRadius: 12,
                                    background: topic.potential === 'High' ? 'rgba(52,168,83,0.15)' : topic.potential === 'Medium' ? 'rgba(216,180,29,0.15)' : 'rgba(255,255,255,0.06)',
                                    color: topic.potential === 'High' ? 'var(--success)' : topic.potential === 'Medium' ? 'var(--accent-primary)' : 'var(--text-muted)',
                                    marginLeft: 8,
                                    whiteSpace: 'nowrap',
                                }}>
                                    {topic.potential}
                                </span>
                            </div>

                            <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                                <span style={badgeStyle(CATEGORY_COLORS[topic.category] || '#888')}>
                                    {topic.category}
                                </span>
                                <span style={badgeStyle('#888')}>
                                    {topic.platform}
                                </span>
                                <span style={badgeStyle('#888')}>
                                    {topic.format}
                                </span>
                                <span style={{
                                    fontSize: '0.5625rem', fontWeight: 700, padding: '2px 6px', borderRadius: 6,
                                    background: isVideoFormat(topic.format) ? 'rgba(239,68,68,0.12)' : 'rgba(56,189,248,0.12)',
                                    color: isVideoFormat(topic.format) ? '#ef4444' : '#38bdf8',
                                    textTransform: 'uppercase', letterSpacing: '0.05em',
                                }}>
                                    {isVideoFormat(topic.format) ? 'Video' : 'Image'}
                                </span>
                            </div>

                            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', margin: '0 0 12px', lineHeight: 1.5 }}>
                                {topic.rationale}
                            </p>

                            <div style={{ display: 'flex', gap: 6 }}>
                                <button
                                    style={{ ...smallBtnStyle, flex: 1 }}
                                    onClick={() => {
                                        const platformMap: Record<string, string> = { 'IG': 'instagram', 'FB': 'facebook', 'YT': 'youtube' };
                                        const postTypeMap: Record<string, string> = {
                                            'Reel': 'reel', 'Story': 'story', 'Post': 'feed', 'Carousel': 'feed',
                                            'Image': 'feed', 'Video': 'feed', 'Short': 'reel',
                                        };
                                        sessionStorage.setItem('research_prefill', JSON.stringify({
                                            caption: `${topic.title}\n\n${topic.rationale}`,
                                            platforms: [platformMap[topic.platform] || 'instagram'],
                                            postType: postTypeMap[topic.format] || 'feed',
                                            source: 'research',
                                        }));
                                        router.push('/publish');
                                    }}
                                >
                                    Use This
                                </button>
                                {!isVideoFormat(topic.format) && (
                                    <button
                                        style={{ ...smallBtnStyle, flex: 1, background: 'rgba(216,180,29,0.1)', color: 'var(--accent-primary)', borderColor: 'rgba(216,180,29,0.3)' }}
                                        onClick={() => {
                                            const platformMap: Record<string, string> = { 'IG': 'instagram', 'FB': 'facebook', 'YT': 'youtube' };
                                            sessionStorage.setItem('research_prefill', JSON.stringify({
                                                prompt: topic.title,
                                                caption: `${topic.title}\n\n${topic.rationale}`,
                                                platforms: [platformMap[topic.platform] || 'instagram'],
                                            }));
                                            router.push('/creatives');
                                        }}
                                    >
                                        Generate Visual
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {!trendLoading && trends.length === 0 && !trendError && (
                <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
                    <div style={{ fontSize: '2rem', marginBottom: 12 }}>
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                        </svg>
                    </div>
                    <p style={{ fontSize: '1rem', fontWeight: 500 }}>Discover trending topics for your content</p>
                    <p style={{ fontSize: '0.8125rem', marginTop: 4 }}>
                        Select a month and focus area, then click &quot;Generate Ideas&quot; to get AI-powered topic suggestions
                    </p>
                </div>
            )}
        </div>
    );

    // ================================================================
    //  RENDER: Content Calendar Tab
    // ================================================================
    const renderContentCalendar = () => (
        <div>
            {/* Month nav + actions */}
            <div className="section-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <button onClick={() => goMonth(-1)} style={navArrowStyle}>&lt;</button>
                    <span style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-secondary)', minWidth: 180, textAlign: 'center' }}>
                        {MONTH_NAMES[selectedMonth - 1]} {selectedYear}
                    </span>
                    <button onClick={() => goMonth(1)} style={navArrowStyle}>&gt;</button>
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button onClick={generateCalendar} disabled={calendarLoading || calendarLoadingFromDB} style={primaryBtnStyle}>
                        {calendarLoading ? 'Generating...' : calendarLoadingFromDB ? 'Loading...' : calendarDays.length > 0 ? 'Regenerate' : 'Generate Calendar'}
                    </button>
                    {calendarDays.length > 0 && (
                        <button
                            style={smallBtnStyle}
                            disabled={queueLoading}
                            onClick={async () => {
                                setQueueLoading(true);
                                setQueueResult(null);
                                try {
                                    const res = await fetch('/api/research/calendar/queue', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ days: calendarDays, month: selectedMonth, year: selectedYear }),
                                    });
                                    const data = await res.json();
                                    if (!res.ok) throw new Error(data.error || 'Failed');
                                    setQueueResult(data);
                                } catch (e: any) {
                                    setCalendarError(e.message);
                                } finally {
                                    setQueueLoading(false);
                                }
                            }}
                        >
                            {queueLoading ? 'Sending...' : 'Send to Queue'}
                        </button>
                    )}
                    {queueResult && (
                        <span style={{ fontSize: '0.75rem', color: 'var(--success)' }}>
                            {queueResult.created} drafts created{queueResult.replaced > 0 ? `, ${queueResult.replaced} replaced` : ''}{queueResult.failed > 0 ? `, ${queueResult.failed} failed` : ''}
                        </span>
                    )}
                </div>
            </div>

            {calendarError && (
                <div style={{ color: 'var(--danger)', padding: '12px 0', fontSize: '0.875rem' }}>{calendarError}</div>
            )}

            {calendarLastGenerated && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 8 }}>
                    Last generated: {calendarLastGenerated}
                </div>
            )}

            {/* Calendar Grid */}
            {calendarDays.length > 0 ? (
                <div style={{ display: 'flex', gap: 24 }}>
                    {/* Calendar */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
                            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                                <div key={d} style={{ textAlign: 'center', fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-muted)', padding: '8px 0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    {d}
                                </div>
                            ))}
                            {calendarGrid.map((day, i) => {
                                const dayNum = i - new Date(selectedYear, selectedMonth - 1, 1).getDay() + 1;
                                return (
                                    <div
                                        key={i}
                                        onClick={() => day && setExpandedDay(expandedDay === day.date ? null : day.date)}
                                        style={{
                                            background: day ? 'var(--bg-card)' : 'transparent',
                                            border: day ? `1px solid ${expandedDay === day?.date ? 'var(--accent-primary)' : 'var(--border-subtle)'}` : '1px solid transparent',
                                            borderRadius: 8,
                                            padding: '8px',
                                            minHeight: 80,
                                            cursor: day ? 'pointer' : 'default',
                                            transition: 'border-color 0.15s',
                                        }}
                                    >
                                        {dayNum > 0 && dayNum <= new Date(selectedYear, selectedMonth, 0).getDate() && (
                                            <>
                                                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
                                                    {dayNum}
                                                </div>
                                                {day && (
                                                    <>
                                                        <div style={{
                                                            fontSize: '0.6875rem',
                                                            fontWeight: 500,
                                                            color: 'var(--text-primary)',
                                                            lineHeight: 1.3,
                                                            marginBottom: 4,
                                                            overflow: 'hidden',
                                                            display: '-webkit-box',
                                                            WebkitLineClamp: 2,
                                                            WebkitBoxOrient: 'vertical',
                                                        }}>
                                                            {day.topic}
                                                        </div>
                                                        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                                                            <span style={{
                                                                fontSize: '0.5625rem',
                                                                padding: '1px 5px',
                                                                borderRadius: 6,
                                                                background: `${CATEGORY_COLORS[day.category] || '#888'}22`,
                                                                color: CATEGORY_COLORS[day.category] || '#888',
                                                                fontWeight: 600,
                                                            }}>
                                                                {day.format}
                                                            </span>
                                                            <span style={{
                                                                fontSize: '0.5625rem',
                                                                padding: '1px 5px',
                                                                borderRadius: 6,
                                                                background: 'rgba(255,255,255,0.05)',
                                                                color: 'var(--text-muted)',
                                                            }}>
                                                                {day.platform}
                                                            </span>
                                                        </div>
                                                    </>
                                                )}
                                            </>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        {/* Expanded Day Detail */}
                        {expandedDay && (() => {
                            const day = calendarDays.find(d => d.date === expandedDay);
                            if (!day) return null;
                            return (
                                <div className="section-card" style={{ marginTop: 12 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                        <div>
                                            <h4 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>{day.topic}</h4>
                                            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                                                <span style={badgeStyle(CATEGORY_COLORS[day.category] || '#888')}>{day.category}</span>
                                                <span style={badgeStyle('#888')}>{day.platform}</span>
                                                <span style={badgeStyle('#888')}>{day.format}</span>
                                            </div>
                                        </div>
                                        <button style={smallBtnStyle} onClick={() => setExpandedDay(null)}>Close</button>
                                    </div>
                                    {day.caption && (
                                        <div style={{ marginTop: 12, padding: 12, background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
                                            <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Caption</div>
                                            <p style={{ fontSize: '0.8125rem', color: 'var(--text-primary)', lineHeight: 1.6, whiteSpace: 'pre-wrap', margin: 0 }}>{day.caption}</p>
                                        </div>
                                    )}
                                    {day.hashtags && (
                                        <div style={{ marginTop: 8, fontSize: '0.75rem', color: 'var(--accent-primary)' }}>{day.hashtags}</div>
                                    )}
                                </div>
                            );
                        })()}
                    </div>

                    {/* Sidebar Summary */}
                    {calendarSummary && (
                        <div style={{ width: 220, flexShrink: 0 }}>
                            <div className="section-card">
                                <h4 style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)', marginTop: 0, marginBottom: 12 }}>Summary</h4>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                                    {calendarSummary.total} posts planned
                                </div>
                                <div style={{ marginTop: 12 }}>
                                    <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>By Platform</div>
                                    {Object.entries(calendarSummary.byPlatform).map(([p, count]) => (
                                        <div key={p} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', padding: '3px 0', color: 'var(--text-primary)' }}>
                                            <span>{p}</span><span style={{ fontWeight: 600 }}>{count}</span>
                                        </div>
                                    ))}
                                </div>
                                <div style={{ marginTop: 12 }}>
                                    <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>By Category</div>
                                    {Object.entries(calendarSummary.byCategory).map(([cat, count]) => (
                                        <div key={cat} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', padding: '3px 0' }}>
                                            <span style={{ color: CATEGORY_COLORS[cat] || 'var(--text-primary)' }}>{cat}</span>
                                            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{count}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            ) : !calendarLoading && !calendarLoadingFromDB && (
                <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
                    <div style={{ fontSize: '2rem', marginBottom: 12 }}>
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                        </svg>
                    </div>
                    <p style={{ fontSize: '1rem', fontWeight: 500 }}>Plan your month&apos;s content</p>
                    <p style={{ fontSize: '0.8125rem', marginTop: 4 }}>
                        Click &quot;Generate Calendar&quot; for an AI-created day-by-day content plan
                        {trends.length > 0 && ' (incorporating your Trend Scout ideas)'}
                    </p>
                </div>
            )}
        </div>
    );

    // ================================================================
    //  RENDER: Market Intel Tab
    // ================================================================
    const renderMarketIntel = () => (
        <div>
            {!marketFetched ? (
                <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
                    <div style={{ fontSize: '2rem', marginBottom: 12 }}>
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                        </svg>
                    </div>
                    <p style={{ fontSize: '1rem', fontWeight: 500 }}>Market intelligence at your fingertips</p>
                    <p style={{ fontSize: '0.8125rem', marginTop: 4, marginBottom: 16 }}>
                        See what&apos;s trending on Instagram, YouTube, and TikTok in the aesthetics industry, plus insights from your own data.
                    </p>
                    <button onClick={fetchMarketIntel} style={primaryBtnStyle}>Load Market Intel</button>
                </div>
            ) : (
                <>
                    {/* Section 1: Trending in Aesthetics */}
                    <div className="section-card">
                        <h3>Trending in Aesthetics</h3>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
                            {/* Instagram Panel */}
                            <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 12, padding: 16 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                                    <span style={{ fontSize: '1.125rem' }}>IG</span>
                                    <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Instagram</span>
                                    {igLoading && <LoadingDots />}
                                </div>
                                {igTrends.length > 0 ? igTrends.map((ht, i) => (
                                    <div key={i} style={{ marginBottom: 12 }}>
                                        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--accent-primary)', marginBottom: 6 }}>#{ht.hashtag}</div>
                                        {ht.posts.slice(0, 3).map((p, j) => (
                                            <a key={j} href={p.permalink} target="_blank" rel="noopener noreferrer" style={{ display: 'block', padding: '6px 0', borderBottom: '1px solid var(--border-subtle)', textDecoration: 'none' }}>
                                                <div style={{ fontSize: '0.75rem', color: 'var(--text-primary)', lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                                                    {p.caption || '(no caption)'}
                                                </div>
                                                <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: 2 }}>
                                                    {p.likeCount.toLocaleString()} likes &middot; {p.commentsCount.toLocaleString()} comments
                                                </div>
                                            </a>
                                        ))}
                                    </div>
                                )) : !igLoading && (
                                    <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>No data available</div>
                                )}
                            </div>

                            {/* YouTube Panel */}
                            <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 12, padding: 16 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                                    <span style={{ fontSize: '1.125rem' }}>YT</span>
                                    <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)' }}>YouTube</span>
                                    {ytLoading && <LoadingDots />}
                                </div>
                                {ytTrends.length > 0 ? ytTrends.map((qs, i) => (
                                    <div key={i} style={{ marginBottom: 12 }}>
                                        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#FF0000', marginBottom: 6 }}>&quot;{qs.query}&quot;</div>
                                        {qs.videos.slice(0, 3).map((v, j) => (
                                            <a key={j} href={`https://youtube.com/watch?v=${v.id}`} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border-subtle)', textDecoration: 'none' }}>
                                                {v.thumbnailUrl && (
                                                    <img src={v.thumbnailUrl} alt="" style={{ width: 80, height: 45, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />
                                                )}
                                                <div style={{ minWidth: 0 }}>
                                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-primary)', fontWeight: 500, lineHeight: 1.3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                                                        {v.title}
                                                    </div>
                                                    <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: 2 }}>
                                                        {v.channelTitle} &middot; {Number(v.viewCount).toLocaleString()} views
                                                    </div>
                                                </div>
                                            </a>
                                        ))}
                                    </div>
                                )) : !ytLoading && (
                                    <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>No data available</div>
                                )}
                            </div>

                            {/* TikTok Panel */}
                            <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 12, padding: 16 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                                    <span style={{ fontSize: '1.125rem' }}>TT</span>
                                    <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)' }}>TikTok</span>
                                    {tiktokLoading && <LoadingDots />}
                                </div>
                                {tiktokSummary ? (
                                    <>
                                        <p style={{ fontSize: '0.8125rem', color: 'var(--text-primary)', lineHeight: 1.5, marginBottom: 12 }}>{tiktokSummary}</p>
                                        {tiktokTrends.map((t, i) => (
                                            <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                                                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)' }}>{t.title}</div>
                                                <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: 2 }}>{t.description}</div>
                                            </div>
                                        ))}
                                    </>
                                ) : !tiktokLoading && (
                                    <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>No data available</div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Section 2: What's Working for You */}
                    <div className="section-card">
                        <h3>What&apos;s Working for You</h3>
                        {marketLoading ? <LoadingDots /> : marketData ? (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 16 }}>
                                <div>
                                    <div style={sectionLabelStyle}>Top Posts by Engagement</div>
                                    {(marketData.topPosts || []).slice(0, 5).map((p, i) => (
                                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: '0.8125rem' }}>
                                            <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '65%' }}>{p.title}</span>
                                            <span style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{(p.engagementRate * 100).toFixed(1)}%</span>
                                        </div>
                                    ))}
                                </div>
                                <div>
                                    <div style={sectionLabelStyle}>Top Lead Sources</div>
                                    {(marketData.topSources || []).slice(0, 5).map((s, i) => (
                                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: '0.8125rem' }}>
                                            <span style={{ color: 'var(--text-primary)' }}>{s.source}</span>
                                            <span style={{ fontWeight: 600, color: s.trend === 'up' ? 'var(--success)' : s.trend === 'down' ? 'var(--danger)' : 'var(--text-muted)' }}>
                                                {s.count} {s.trend === 'up' ? '\u2191' : s.trend === 'down' ? '\u2193' : ''}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                                <div>
                                    <div style={sectionLabelStyle}>Most-Booked Treatments</div>
                                    {(marketData.topTreatments || []).slice(0, 5).map((t, i) => (
                                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: '0.8125rem' }}>
                                            <span style={{ color: 'var(--text-primary)' }}>{t.name}</span>
                                            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{t.count}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>No data available</div>
                        )}
                    </div>

                    {/* Section 3: Patient Demand Signals */}
                    <div className="section-card">
                        <h3>Patient Demand Signals</h3>
                        {marketLoading ? <LoadingDots /> : marketData?.searchQueries?.length ? (
                            <div>
                                <div style={sectionLabelStyle}>Top Search Queries</div>
                                <div style={{ overflowX: 'auto' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                                        <thead>
                                            <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                                <th style={thStyle}>Query</th>
                                                <th style={{ ...thStyle, textAlign: 'right' }}>Clicks</th>
                                                <th style={{ ...thStyle, textAlign: 'right' }}>Impressions</th>
                                                <th style={{ ...thStyle, textAlign: 'right' }}>Position</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {marketData.searchQueries.slice(0, 10).map((q, i) => (
                                                <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                                    <td style={tdStyle}>{q.query}</td>
                                                    <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>{q.clicks}</td>
                                                    <td style={{ ...tdStyle, textAlign: 'right' }}>{q.impressions.toLocaleString()}</td>
                                                    <td style={{ ...tdStyle, textAlign: 'right' }}>{q.position.toFixed(1)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        ) : !marketLoading && (
                            <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>No search data available</div>
                        )}
                    </div>

                    {/* Section 4: Promotion Ideas */}
                    <div className="section-card">
                        <h3>Promotion Ideas</h3>
                        {marketLoading ? <LoadingDots /> : marketData?.promotionIdeas?.length ? (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                                {marketData.promotionIdeas.map((p, i) => (
                                    <div key={i} style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 10, padding: 14, border: '1px solid var(--border-subtle)' }}>
                                        <div style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>{p.name}</div>
                                        <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: 4 }}><strong>Offer:</strong> {p.offer}</div>
                                        <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: 4 }}><strong>Audience:</strong> {p.audience}</div>
                                        <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}><strong>Angle:</strong> {p.angle}</div>
                                    </div>
                                ))}
                            </div>
                        ) : !marketLoading && (
                            <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Promotion ideas will appear once market data loads</div>
                        )}
                    </div>

                    {/* Refresh button */}
                    <div style={{ textAlign: 'center', padding: '8px 0' }}>
                        <button onClick={fetchMarketIntel} style={smallBtnStyle}>Refresh All</button>
                    </div>
                </>
            )}
        </div>
    );

    // ================================================================
    //  MAIN RENDER
    // ================================================================
    return (
        <div className="page-container">
            <div className="page-header">
                <h1>Research</h1>
                <div className="subtitle">Pre-planning intelligence — discover trends, plan content, and identify opportunities</div>
            </div>

            {/* Tab bar */}
            <div className="sub-tabs" style={{ marginBottom: 24 }}>
                {TABS.map(tab => (
                    <button
                        key={tab}
                        className={`sub-tab ${activeTab === tab ? 'active' : ''}`}
                        onClick={() => setActiveTab(tab)}
                    >
                        {tab}
                    </button>
                ))}
            </div>

            {activeTab === 'Trend Scout' && renderTrendScout()}
            {activeTab === 'Content Calendar' && renderContentCalendar()}
            {activeTab === 'Market Intel' && renderMarketIntel()}
        </div>
    );
}

// ================================================================
//  Shared Styles
// ================================================================

const selectStyle: React.CSSProperties = {
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '6px 12px',
    color: 'var(--text-primary)',
    fontSize: '0.8125rem',
    fontFamily: 'var(--font-sans)',
    cursor: 'pointer',
};

const primaryBtnStyle: React.CSSProperties = {
    background: 'var(--accent-primary)',
    color: '#0A1628',
    border: 'none',
    borderRadius: 8,
    padding: '8px 20px',
    fontSize: '0.8125rem',
    fontWeight: 600,
    fontFamily: 'var(--font-sans)',
    cursor: 'pointer',
    transition: 'opacity 0.15s',
};

const smallBtnStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.06)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '6px 14px',
    fontSize: '0.75rem',
    fontWeight: 500,
    fontFamily: 'var(--font-sans)',
    cursor: 'pointer',
    transition: 'all 0.15s',
};

const navArrowStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '6px 12px',
    color: 'var(--text-primary)',
    fontSize: '1rem',
    cursor: 'pointer',
    fontFamily: 'var(--font-sans)',
};

const sectionLabelStyle: React.CSSProperties = {
    fontSize: '0.6875rem',
    fontWeight: 600,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: 8,
};

const thStyle: React.CSSProperties = {
    padding: '8px 12px',
    textAlign: 'left',
    fontSize: '0.6875rem',
    fontWeight: 600,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
};

const tdStyle: React.CSSProperties = {
    padding: '8px 12px',
    color: 'var(--text-primary)',
};

function badgeStyle(color: string): React.CSSProperties {
    return {
        fontSize: '0.625rem',
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: 10,
        background: `${color}22`,
        color,
        textTransform: 'capitalize',
    };
}

function LoadingDots() {
    return <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Loading...</span>;
}
