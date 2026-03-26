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

const INTENT_COLORS: Record<string, { bg: string; text: string }> = {
    reach: { bg: 'rgba(56,189,248,0.12)', text: '#38bdf8' },
    convert: { bg: 'rgba(52,168,83,0.12)', text: '#34A853' },
};

interface TrendTopic {
    title: string;
    platform: string;
    format: string;
    hook: string;
    suggested_cta: string;
    rationale: string;
    content_intent: 'reach' | 'convert';
    category: string;
    opportunity_score: number;
    money_maker_alert: { active: boolean; message: string } | null;
    booking_url: string;
    // Legacy fields for backward compat
    potential?: string;
}

interface FeedbackSummary {
    publishedCount: number;
    totalSuggested: number;
    topPerformer: { topic: string; engagement: number; views: number } | null;
    avgEngagement: number;
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
    topPosts: Array<{ title: string; platform: string; engagementRate: number; views: number; likes: number; comments: number; shares: number; saves: number; permalink: string }>;
    bestTimes: Array<{ hour: number; avgEngagement: number }>;
    topSources: Array<{ source: string; count: number; trend: 'up' | 'down' | 'flat' }>;
    topTreatments: Array<{ name: string; count: number }>;
    searchQueries: Array<{ query: string; clicks: number; impressions: number; position: number }>;
    promotionIdeas: Array<{ name: string; offer: string; audience: string; angle: string }>;
}

interface CompetitorCard {
    username: string;
    followers: number;
    avgEngagement: number;
    postingFrequency: number;
    engagementTrend: string;
    contentMix: { images: number; videos: number; carousels: number };
    topHashtags: Array<{ tag: string; count: number }>;
    viralPosts: Array<{ caption: string; likeCount: number; commentsCount: number; engagementRate: number; multiplier: number; permalink: string }>;
}

interface CompetitorWatchData {
    competitors: CompetitorCard[];
    hashtagGaps: Array<{ tag: string; competitorCount: number }>;
    contentGaps: Array<{ keyword: string; label: string; competitorCount: number }>;
    summary: { totalCompetitors: number; competitorAvgEngagement: number; ourAvgEngagement: number; engagementDiff: string | null };
}

interface ContentCategoryStats {
    category: string;
    label: string;
    postCount: number;
    avgViews: number;
    avgLikes: number;
    avgComments: number;
    avgEngagement: number;
    bestPost: { caption: string; views: number; engagement: number; permalink: string } | null;
}

interface ContentAnalysisData {
    categories: ContentCategoryStats[];
    totalPosts: number;
    overallAvgEngagement: number;
    overallAvgViews: number;
    period: string;
}

interface TrafficSourceData {
    sourceBreakdown: Array<{ source: string; medium: string; sessions: number; users: number }>;
    instagramVisits: number;
    instagramTopPages: Array<{ page: string; views: number; sessions: number }>;
    facebookVisits: number;
    googleVisits: number;
    directVisits: number;
    totalSessions: number;
    period: string;
    isMock: boolean;
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
    const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 2 > 12 ? 1 : now.getMonth() + 2);
    const [selectedYear, setSelectedYear] = useState(now.getMonth() + 2 > 12 ? now.getFullYear() + 1 : now.getFullYear());

    // --- Trend Scout state ---
    const [trendFocus, setTrendFocus] = useState('all');
    const [trends, setTrends] = useState<TrendTopic[]>([]);
    const [trendLoading, setTrendLoading] = useState(false);
    const [trendLastGenerated, setTrendLastGenerated] = useState<string | null>(null);
    const [trendError, setTrendError] = useState<string | null>(null);
    const [feedback, setFeedback] = useState<FeedbackSummary | null>(null);

    // --- Content Calendar state ---
    const [calendarDays, setCalendarDays] = useState<CalendarDay[]>([]);
    const [calendarLoading, setCalendarLoading] = useState(false);
    const [calendarLastGenerated, setCalendarLastGenerated] = useState<string | null>(null);
    const [calendarError, setCalendarError] = useState<string | null>(null);
    const [expandedDay, setExpandedDay] = useState<string | null>(null);
    const [queueLoading, setQueueLoading] = useState(false);
    const [queueResult, setQueueResult] = useState<{ created: number; failed: number; replaced: number } | null>(null);
    const [scheduledDates, setScheduledDates] = useState<Set<string>>(new Set());
    const [dayScheduleLoading, setDayScheduleLoading] = useState<string | null>(null);
    const [calendarLoadingFromDB, setCalendarLoadingFromDB] = useState(false);

    // --- Market Intel state ---
    const [igTrends, setIgTrends] = useState<SocialTrendIG[]>([]);
    const [ytTrends, setYtTrends] = useState<SocialTrendYT[]>([]);
    const [marketData, setMarketData] = useState<MarketData | null>(null);
    const [igLoading, setIgLoading] = useState(false);
    const [ytLoading, setYtLoading] = useState(false);
    const [marketLoading, setMarketLoading] = useState(false);
    const [marketFetched, setMarketFetched] = useState(false);
    const [competitorData, setCompetitorData] = useState<CompetitorWatchData | null>(null);
    const [competitorLoading, setCompetitorLoading] = useState(false);
    const [contentAnalysis, setContentAnalysis] = useState<ContentAnalysisData | null>(null);
    const [contentAnalysisLoading, setContentAnalysisLoading] = useState(false);
    const [trafficData, setTrafficData] = useState<TrafficSourceData | null>(null);
    const [trafficLoading, setTrafficLoading] = useState(false);

    // --- Calendar Persistence ---
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

    // Fetch scheduled dates for calendar overlap indicators
    useEffect(() => {
        if (activeTab === 'Content Calendar') {
            fetch('/api/content/publish?type=posts')
                .then(r => r.json())
                .then(data => {
                    const dates = new Set<string>();
                    for (const post of (data.posts || [])) {
                        if (post.status === 'SCHEDULED' && post.scheduledFor) {
                            const d = new Date(post.scheduledFor);
                            dates.add(d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }));
                        }
                    }
                    setScheduledDates(dates);
                })
                .catch(() => {});
        }
    }, [activeTab, selectedMonth, selectedYear]);

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
            setFeedback(data.feedback || null);
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
                    savedTopics: trends.length > 0 ? trends : undefined,
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

        // Fetch all sources in parallel
        setIgLoading(true);
        setYtLoading(true);
        setMarketLoading(true);
        setCompetitorLoading(true);
        setContentAnalysisLoading(true);
        setTrafficLoading(true);

        // Competitor Watch
        fetch('/api/research/competitor-watch?location=all')
            .then(r => r.json())
            .then(d => setCompetitorData(d))
            .catch(() => {})
            .finally(() => setCompetitorLoading(false));

        // Content Performance Analysis
        fetch('/api/research/content-analysis')
            .then(r => r.json())
            .then(d => setContentAnalysis(d))
            .catch(() => {})
            .finally(() => setContentAnalysisLoading(false));

        // Traffic Sources (GA4)
        fetch('/api/research/traffic-sources?days=30')
            .then(r => r.json())
            .then(d => setTrafficData(d))
            .catch(() => {})
            .finally(() => setTrafficLoading(false));

        // IG hashtag trends
        fetch('/api/research/social-trends?source=instagram')
            .then(r => r.json())
            .then(d => setIgTrends(d.results || []))
            .catch(() => {})
            .finally(() => setIgLoading(false));

        // YT search trends
        fetch('/api/research/social-trends?source=youtube')
            .then(r => r.json())
            .then(d => setYtTrends(d.results || []))
            .catch(() => {})
            .finally(() => setYtLoading(false));

        // Internal data
        fetch(`/api/research/market?month=${selectedMonth}&year=${selectedYear}`)
            .then(r => r.json())
            .then(d => setMarketData(d))
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
        const firstDay = new Date(selectedYear, selectedMonth - 1, 1).getDay();
        const daysInMonth = new Date(selectedYear, selectedMonth, 0).getDate();
        const grid: (CalendarDay | null)[] = [];
        for (let i = 0; i < firstDay; i++) grid.push(null);
        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const dayData = calendarDays.find(cd => cd.date === dateStr);
            grid.push(dayData || null);
        }
        return grid;
    }, [calendarDays, selectedMonth, selectedYear]);

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

    // --- Helpers ---
    function scoreColor(score: number): string {
        if (score >= 70) return '#34A853';
        if (score >= 40) return '#D8B41D';
        return '#888';
    }

    function copyToClipboard(text: string) {
        navigator.clipboard.writeText(text).catch(() => {});
    }

    // ================================================================
    //  RENDER: Trend Scout Tab
    // ================================================================
    const renderTrendScout = () => (
        <div>
            {/* Feedback Banner */}
            {feedback && feedback.publishedCount > 0 && (
                <div className="section-card" style={{ background: 'rgba(52,168,83,0.06)', borderColor: 'rgba(52,168,83,0.2)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.8125rem', color: 'var(--text-primary)' }}>
                            Last Month: <strong>{feedback.publishedCount}</strong> of {feedback.totalSuggested} topics published.
                        </span>
                        {feedback.topPerformer && (
                            <span style={{ fontSize: '0.8125rem', color: 'var(--success)' }}>
                                Top performer: &quot;{feedback.topPerformer.topic.slice(0, 50)}&quot; ({(feedback.topPerformer.engagement * 100).toFixed(1)}% engagement)
                            </span>
                        )}
                    </div>
                </div>
            )}

            {/* Config bar */}
            <div className="section-card" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Month:</label>
                    <select value={selectedMonth} onChange={e => setSelectedMonth(Number(e.target.value))} style={selectStyle}>
                        {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                    </select>
                    <select value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))} style={selectStyle}>
                        <option value={2026}>2026</option>
                        <option value={2027}>2027</option>
                    </select>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Focus:</label>
                    <select value={trendFocus} onChange={e => setTrendFocus(e.target.value)} style={selectStyle}>
                        {FOCUS_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                    </select>
                </div>
                <button onClick={generateTrends} disabled={trendLoading} style={primaryBtnStyle}>
                    {trendLoading ? 'Generating...' : 'Generate Ideas'}
                </button>
                {trendLastGenerated && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Last generated: {trendLastGenerated}</span>
                )}
            </div>

            {trendError && (
                <div style={{ color: 'var(--danger)', padding: '12px 0', fontSize: '0.875rem' }}>{trendError}</div>
            )}

            {/* Results Grid */}
            {trends.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16, marginTop: 16 }}>
                    {trends.map((topic, i) => (
                        <div key={i} className="section-card" style={{ marginBottom: 0 }}>
                            {/* Header: title + score */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                                <h4 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0, lineHeight: 1.3, flex: 1 }}>
                                    {topic.title}
                                </h4>
                                {/* Opportunity Score Circle */}
                                <div style={{
                                    width: 38, height: 38, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    border: `2px solid ${scoreColor(topic.opportunity_score)}`,
                                    color: scoreColor(topic.opportunity_score),
                                    fontSize: '0.75rem', fontWeight: 700, marginLeft: 8, flexShrink: 0,
                                }}>
                                    {topic.opportunity_score}
                                </div>
                            </div>

                            {/* Badges: category, platform, format, intent, money-maker */}
                            <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                                <span style={badgeStyle(CATEGORY_COLORS[topic.category] || '#888')}>{topic.category}</span>
                                <span style={badgeStyle('#888')}>{topic.platform}</span>
                                <span style={badgeStyle('#888')}>{topic.format}</span>
                                <span style={{
                                    fontSize: '0.625rem', fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                                    background: INTENT_COLORS[topic.content_intent]?.bg || 'rgba(255,255,255,0.06)',
                                    color: INTENT_COLORS[topic.content_intent]?.text || '#888',
                                    textTransform: 'uppercase',
                                }}>
                                    {topic.content_intent}
                                </span>
                                {topic.money_maker_alert?.active && (
                                    <span style={{
                                        fontSize: '0.5625rem', fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                                        background: 'rgba(216,180,29,0.15)', color: '#D8B41D',
                                    }}>
                                        $ {topic.money_maker_alert.message}
                                    </span>
                                )}
                            </div>

                            {/* Hook preview */}
                            {topic.hook && (
                                <div style={{ padding: '8px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: 6, marginBottom: 8, borderLeft: '3px solid var(--accent-primary)' }}>
                                    <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Hook</div>
                                    <p style={{ fontSize: '0.8125rem', color: 'var(--text-primary)', margin: 0, lineHeight: 1.5, fontStyle: 'italic' }}>
                                        &quot;{topic.hook}&quot;
                                    </p>
                                </div>
                            )}

                            {/* CTA preview */}
                            {topic.suggested_cta && (
                                <div style={{ padding: '8px 10px', background: 'rgba(52,168,83,0.04)', borderRadius: 6, marginBottom: 8, borderLeft: '3px solid #34A853' }}>
                                    <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>CTA</div>
                                    <p style={{ fontSize: '0.8125rem', color: 'var(--text-primary)', margin: 0, lineHeight: 1.5 }}>
                                        {topic.suggested_cta}
                                    </p>
                                </div>
                            )}

                            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', margin: '0 0 12px', lineHeight: 1.5 }}>
                                {topic.rationale}
                            </p>

                            {/* Action buttons */}
                            <div style={{ display: 'flex', gap: 6 }}>
                                <button
                                    style={{ ...smallBtnStyle, flex: 1 }}
                                    onClick={() => {
                                        const platformMap: Record<string, string> = { 'Instagram': 'instagram', 'Facebook': 'facebook', 'YouTube': 'youtube', 'All': 'instagram' };
                                        const postTypeMap: Record<string, string> = {
                                            'Reel': 'reel', 'Story': 'story', 'Post': 'feed', 'Carousel': 'feed',
                                            'YouTube Short': 'reel', 'YouTube Video': 'feed',
                                        };
                                        const caption = [topic.hook, '', topic.rationale, '', topic.suggested_cta, '', topic.booking_url].filter(Boolean).join('\n');
                                        sessionStorage.setItem('research_prefill', JSON.stringify({
                                            caption,
                                            platforms: [platformMap[topic.platform] || 'instagram'],
                                            postType: postTypeMap[topic.format] || 'feed',
                                            source: 'research',
                                        }));
                                        router.push('/publish');
                                    }}
                                >
                                    Use This
                                </button>
                                <button
                                    style={{ ...smallBtnStyle, flex: 1, background: 'rgba(52,168,83,0.08)', color: '#34A853', borderColor: 'rgba(52,168,83,0.3)' }}
                                    onClick={() => {
                                        const text = [topic.hook, '', topic.suggested_cta, '', topic.booking_url].filter(Boolean).join('\n');
                                        copyToClipboard(text);
                                    }}
                                >
                                    Copy CTA
                                </button>
                                {!isVideoFormat(topic.format) && (
                                    <button
                                        style={{ ...smallBtnStyle, flex: 1, background: 'rgba(216,180,29,0.1)', color: 'var(--accent-primary)', borderColor: 'rgba(216,180,29,0.3)' }}
                                        onClick={() => {
                                            sessionStorage.setItem('research_prefill', JSON.stringify({
                                                prompt: topic.title,
                                                caption: `${topic.hook}\n\n${topic.suggested_cta}`,
                                                platforms: ['instagram'],
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
                    <p style={{ fontSize: '1rem', fontWeight: 500 }}>Discover high-priority content topics</p>
                    <p style={{ fontSize: '0.8125rem', marginTop: 4 }}>
                        10 AI-powered topic ideas scored by search demand, engagement potential, and competitor gaps — each with a ready-to-use hook and CTA
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
                            {queueLoading ? 'Scheduling...' : 'Schedule All to Queue'}
                        </button>
                    )}
                    {queueResult && (
                        <span style={{ fontSize: '0.75rem', color: 'var(--success)' }}>
                            {queueResult.created} scheduled{queueResult.replaced > 0 ? `, ${queueResult.replaced} replaced` : ''}{queueResult.failed > 0 ? `, ${queueResult.failed} failed` : ''}
                        </span>
                    )}
                </div>
            </div>

            {calendarError && <div style={{ color: 'var(--danger)', padding: '12px 0', fontSize: '0.875rem' }}>{calendarError}</div>}
            {calendarLastGenerated && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 8 }}>Last generated: {calendarLastGenerated}</div>}

            {calendarDays.length > 0 ? (
                <div style={{ display: 'flex', gap: 24 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
                            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                                <div key={d} style={{ textAlign: 'center', fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-muted)', padding: '8px 0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{d}</div>
                            ))}
                            {calendarGrid.map((day, i) => {
                                const dayNum = i - new Date(selectedYear, selectedMonth - 1, 1).getDay() + 1;
                                return (
                                    <div key={i} onClick={() => day && setExpandedDay(expandedDay === day.date ? null : day.date)} style={{
                                        background: day ? 'var(--bg-card)' : 'transparent',
                                        border: day ? `1px solid ${expandedDay === day?.date ? 'var(--accent-primary)' : 'var(--border-subtle)'}` : '1px solid transparent',
                                        borderRadius: 8, padding: '8px', minHeight: 80, cursor: day ? 'pointer' : 'default', transition: 'border-color 0.15s',
                                    }}>
                                        {dayNum > 0 && dayNum <= new Date(selectedYear, selectedMonth, 0).getDate() && (
                                            <>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>{dayNum}</span>
                                                    {day && scheduledDates.has(day.date) && (
                                                        <span style={{ fontSize: '0.5rem', padding: '1px 4px', borderRadius: 4, background: 'rgba(34,197,94,0.12)', color: '#22c55e', fontWeight: 700 }}>Queued</span>
                                                    )}
                                                </div>
                                                {day && (
                                                    <>
                                                        <div style={{ fontSize: '0.6875rem', fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.3, marginBottom: 4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{day.topic}</div>
                                                        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                                                            <span style={{ fontSize: '0.5625rem', padding: '1px 5px', borderRadius: 6, background: `${CATEGORY_COLORS[day.category] || '#888'}22`, color: CATEGORY_COLORS[day.category] || '#888', fontWeight: 600 }}>{day.format}</span>
                                                            <span style={{ fontSize: '0.5625rem', padding: '1px 5px', borderRadius: 6, background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)' }}>{day.platform}</span>
                                                        </div>
                                                    </>
                                                )}
                                            </>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

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
                                    {day.hashtags && <div style={{ marginTop: 8, fontSize: '0.75rem', color: 'var(--accent-primary)' }}>{day.hashtags}</div>}
                                    <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                                        <button
                                            style={{ ...smallBtnStyle, background: scheduledDates.has(day.date) ? 'rgba(34,197,94,0.1)' : undefined, color: scheduledDates.has(day.date) ? '#22c55e' : undefined }}
                                            disabled={dayScheduleLoading === day.date || scheduledDates.has(day.date)}
                                            onClick={async (e) => {
                                                e.stopPropagation();
                                                setDayScheduleLoading(day.date);
                                                try {
                                                    const res = await fetch('/api/research/calendar/queue', {
                                                        method: 'POST',
                                                        headers: { 'Content-Type': 'application/json' },
                                                        body: JSON.stringify({ days: [day], month: selectedMonth, year: selectedYear }),
                                                    });
                                                    if (res.ok) {
                                                        setScheduledDates(prev => new Set([...prev, day.date]));
                                                    }
                                                } catch { /* ignore */ }
                                                setDayScheduleLoading(null);
                                            }}
                                        >
                                            {scheduledDates.has(day.date) ? 'Scheduled' : dayScheduleLoading === day.date ? 'Scheduling...' : 'Schedule This Post'}
                                        </button>
                                    </div>
                                </div>
                            );
                        })()}
                    </div>

                    {calendarSummary && (
                        <div style={{ width: 220, flexShrink: 0 }}>
                            <div className="section-card">
                                <h4 style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)', marginTop: 0, marginBottom: 12 }}>Summary</h4>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>{calendarSummary.total} posts planned</div>
                                <div style={{ marginTop: 12 }}>
                                    <div style={sectionLabelStyle}>By Platform</div>
                                    {Object.entries(calendarSummary.byPlatform).map(([p, count]) => (
                                        <div key={p} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', padding: '3px 0', color: 'var(--text-primary)' }}>
                                            <span>{p}</span><span style={{ fontWeight: 600 }}>{count}</span>
                                        </div>
                                    ))}
                                </div>
                                <div style={{ marginTop: 12 }}>
                                    <div style={sectionLabelStyle}>By Category</div>
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
                        Click &quot;Generate Calendar&quot; for an AI-created day-by-day content plan with CTAs and booking links
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
                        See what competitors are doing, how your content performs by type, where your website traffic comes from, plus your own data insights.
                    </p>
                    <button onClick={fetchMarketIntel} style={primaryBtnStyle}>Load Market Intel</button>
                </div>
            ) : (
                <>
                    {/* Section 1: Your Content Mix */}
                    <div className="section-card">
                        <h3>Your Content Mix (Last 90 Days)</h3>
                        {contentAnalysisLoading ? <LoadingDots /> : contentAnalysis && contentAnalysis.categories.length > 0 ? (
                            <div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 12 }}>
                                    {contentAnalysis.totalPosts} posts analyzed &middot; Overall avg: {(contentAnalysis.overallAvgEngagement * 100).toFixed(1)}% engagement, {contentAnalysis.overallAvgViews.toLocaleString()} views
                                    <br /><span style={{ fontSize: '0.6875rem', opacity: 0.7 }}>Engagement rate = (likes + comments + shares + saves) &divide; views</span>
                                </div>
                                <div style={{ overflowX: 'auto' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                                        <thead>
                                            <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                                <th style={thStyle}>Category</th>
                                                <th style={{ ...thStyle, textAlign: 'right' }}>Posts</th>
                                                <th style={{ ...thStyle, textAlign: 'right' }}>Avg Views</th>
                                                <th style={{ ...thStyle, textAlign: 'right' }}>Avg Engagement</th>
                                                <th style={{ ...thStyle, textAlign: 'right' }}>Avg Likes</th>
                                                <th style={{ ...thStyle, textAlign: 'right' }}>Avg Comments</th>
                                                <th style={thStyle}>Best Post</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {contentAnalysis.categories.map((cat, i) => (
                                                <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                                    <td style={{ ...tdStyle, fontWeight: 600 }}>{cat.label}</td>
                                                    <td style={{ ...tdStyle, textAlign: 'right' }}>{cat.postCount}</td>
                                                    <td style={{ ...tdStyle, textAlign: 'right' }}>{cat.avgViews.toLocaleString()}</td>
                                                    <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600, color: cat.avgEngagement >= contentAnalysis.overallAvgEngagement ? 'var(--success)' : 'var(--text-muted)' }}>
                                                        {(cat.avgEngagement * 100).toFixed(1)}%
                                                        <div style={{ fontSize: '0.625rem', fontWeight: 400, color: 'var(--text-muted)' }}>
                                                            ~{Math.round(cat.avgLikes + cat.avgComments)} interactions/post
                                                        </div>
                                                    </td>
                                                    <td style={{ ...tdStyle, textAlign: 'right' }}>{cat.avgLikes}</td>
                                                    <td style={{ ...tdStyle, textAlign: 'right' }}>{cat.avgComments}</td>
                                                    <td style={tdStyle}>
                                                        {cat.bestPost ? (
                                                            <a href={cat.bestPost.permalink} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-primary)', textDecoration: 'none', fontSize: '0.75rem' }}>
                                                                {cat.bestPost.caption.slice(0, 40)}...
                                                            </a>
                                                        ) : '—'}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        ) : !contentAnalysisLoading && (
                            <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>No post data from the last 90 days. Posts will appear here once your social content syncs.</div>
                        )}
                    </div>

                    {/* Section 2: Traffic Sources */}
                    <div className="section-card">
                        <h3>Website Traffic Sources {trafficData?.isMock && <span style={{ fontSize: '0.625rem', color: 'var(--text-muted)', fontWeight: 400 }}>(Demo — connect GA4 for live data)</span>}</h3>
                        {trafficLoading ? <LoadingDots /> : trafficData ? (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
                                <div>
                                    <div style={sectionLabelStyle}>Sessions by Source (30d)</div>
                                    {trafficData.sourceBreakdown.slice(0, 6).map((s, i) => (
                                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: '0.8125rem' }}>
                                            <span style={{ color: 'var(--text-primary)' }}>{s.source === '(direct)' ? 'Direct Visits' : s.source}{s.medium && s.medium !== '(none)' ? ` / ${s.medium}` : ''}</span>
                                            <span style={{ fontWeight: 600, color: s.source.toLowerCase().includes('instagram') ? '#E130A4' : 'var(--text-primary)' }}>{s.sessions.toLocaleString()}</span>
                                        </div>
                                    ))}
                                </div>
                                <div>
                                    <div style={sectionLabelStyle}>Instagram Top Pages</div>
                                    {trafficData.instagramTopPages.slice(0, 5).map((p, i) => (
                                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: '0.8125rem' }}>
                                            <span style={{ color: 'var(--text-primary)' }}>{p.page}</span>
                                            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{p.views} views</span>
                                        </div>
                                    ))}
                                    <div style={{ marginTop: 8, fontSize: '0.75rem', color: '#E130A4', fontWeight: 600 }}>
                                        Instagram: {trafficData.instagramVisits.toLocaleString()} visits ({trafficData.totalSessions > 0 ? ((trafficData.instagramVisits / trafficData.totalSessions) * 100).toFixed(1) : 0}%)
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>No traffic data available</div>
                        )}
                    </div>

                    {/* Section 3: Competitor Watch */}
                    <div className="section-card">
                        <h3>Competitor Watch</h3>
                        {competitorLoading ? <LoadingDots /> : competitorData ? (
                            <>
                                {competitorData.summary && (
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 12 }}>
                                        {competitorData.summary.totalCompetitors} competitors tracked
                                        {competitorData.summary.engagementDiff && (
                                            <> &middot; Your engagement is <span style={{ color: Number(competitorData.summary.engagementDiff) >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
                                                {Number(competitorData.summary.engagementDiff) >= 0 ? '+' : ''}{competitorData.summary.engagementDiff}%
                                            </span> vs competitor avg</>
                                        )}
                                    </div>
                                )}

                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 12, marginBottom: 16 }}>
                                    {competitorData.competitors.slice(0, 6).map((c, i) => (
                                        <div key={i} style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 10, padding: 14, border: '1px solid var(--border-subtle)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                                <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.875rem' }}>@{c.username}</span>
                                                <span title={c.engagementTrend === 'growing' ? 'Engagement rate increasing over recent posts' : c.engagementTrend === 'declining' ? 'Engagement rate decreasing over recent posts' : 'Engagement rate is steady'} style={{ fontSize: '0.6875rem', padding: '2px 8px', borderRadius: 6, background: c.engagementTrend === 'growing' ? 'rgba(34,197,94,0.1)' : c.engagementTrend === 'declining' ? 'rgba(239,68,68,0.1)' : 'rgba(255,255,255,0.05)', color: c.engagementTrend === 'growing' ? 'var(--success)' : c.engagementTrend === 'declining' ? 'var(--danger)' : 'var(--text-muted)' }}>
                                                    {c.engagementTrend === 'growing' ? '\u2191 Growing' : c.engagementTrend === 'declining' ? '\u2193 Declining' : '\u2192 Steady'}
                                                </span>
                                            </div>
                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6 }}>
                                                {c.followers.toLocaleString()} followers &middot; {(c.avgEngagement * 100).toFixed(1)}% eng &middot; {c.postingFrequency.toFixed(1)}/week
                                            </div>
                                            {c.topHashtags.length > 0 && (
                                                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                                    {c.topHashtags.slice(0, 4).map((h, j) => (
                                                        <span key={j} style={{ fontSize: '0.625rem', padding: '1px 6px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', color: 'var(--accent-primary)' }}>
                                                            #{h.tag}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>

                                {/* Gaps */}
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                                    {competitorData.hashtagGaps.length > 0 && (
                                        <div>
                                            <div style={sectionLabelStyle}>Hashtags They Use That You Don&apos;t</div>
                                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                                {competitorData.hashtagGaps.slice(0, 10).map((g, i) => (
                                                    <span key={i} style={{ fontSize: '0.6875rem', padding: '3px 8px', borderRadius: 8, background: 'rgba(216,180,29,0.08)', color: 'var(--accent-primary)', border: '1px solid rgba(216,180,29,0.2)' }}>
                                                        #{g.tag} ({g.competitorCount})
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    {competitorData.contentGaps.length > 0 && (
                                        <div>
                                            <div style={sectionLabelStyle}>Treatments Not Mentioned in Your Recent Posts</div>
                                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                                {competitorData.contentGaps.slice(0, 8).map((g, i) => (
                                                    <span key={i} style={{ fontSize: '0.6875rem', padding: '3px 8px', borderRadius: 8, background: 'rgba(225,48,164,0.08)', color: '#E130A4', border: '1px solid rgba(225,48,164,0.2)' }}>
                                                        {g.label} ({g.competitorCount})
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </>
                        ) : (
                            <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>No competitor data available</div>
                        )}
                    </div>

                    {/* Section 4: What's Working for You */}
                    <div className="section-card">
                        <h3>What&apos;s Working for You</h3>
                        {marketLoading ? <LoadingDots /> : marketData ? (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 16 }}>
                                <div>
                                    <div style={sectionLabelStyle}>Top Posts by Engagement</div>
                                    {(marketData.topPosts || []).slice(0, 5).map((p, i) => (
                                        <a key={i} href={p.permalink || '#'} target="_blank" rel="noopener noreferrer" style={{ display: 'block', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: '0.8125rem', textDecoration: 'none', color: 'inherit' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>{p.title}</span>
                                                <span style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{(p.engagementRate * 100).toFixed(1)}%</span>
                                            </div>
                                            <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: 2 }}>
                                                {p.views?.toLocaleString() || 0} views &middot; {p.likes || 0} likes &middot; {p.comments || 0} comments{p.shares ? ` \u00B7 ${p.shares} shares` : ''}
                                            </div>
                                        </a>
                                    ))}
                                </div>
                                <div>
                                    <div style={sectionLabelStyle}>Top Lead Sources</div>
                                    {(marketData.topSources || []).slice(0, 5).map((s, i) => (
                                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: '0.8125rem' }}>
                                            <span style={{ color: 'var(--text-primary)' }}>{s.source === 'Unknown' ? 'Untagged Contacts' : s.source}</span>
                                            <span style={{ fontWeight: 600, color: s.trend === 'up' ? 'var(--success)' : s.trend === 'down' ? 'var(--danger)' : 'var(--text-muted)' }}>
                                                {s.count} {s.trend === 'up' ? '\u2191' : s.trend === 'down' ? '\u2193' : ''}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                                <div>
                                    <div style={sectionLabelStyle}>Most-Booked Treatments (90d)</div>
                                    {(marketData.topTreatments || []).length > 0 ? (marketData.topTreatments || []).slice(0, 5).map((t, i) => {
                                        const maxCount = marketData.topTreatments[0]?.count || 1;
                                        return (
                                            <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: '0.8125rem' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                                                    <span style={{ color: 'var(--text-primary)' }}>{t.name}</span>
                                                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{t.count} appointments</span>
                                                </div>
                                                <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}>
                                                    <div style={{ width: `${(t.count / maxCount) * 100}%`, height: '100%', borderRadius: 2, background: 'var(--accent-primary)' }} />
                                                </div>
                                            </div>
                                        );
                                    }) : (
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Requires MindBody appointment data. Run backfill in Settings.</div>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>No data available</div>
                        )}
                    </div>

                    {/* Section 5: Patient Demand Signals */}
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
                            <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>No search data available. This requires Google Search Console data to be synced.</div>
                        )}
                    </div>

                    {/* Section 6: Promotion Ideas */}
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

            <div className="sub-tabs" style={{ marginBottom: 24 }}>
                {TABS.map(tab => (
                    <button key={tab} className={`sub-tab ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>
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
    background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
    padding: '6px 12px', color: 'var(--text-primary)', fontSize: '0.8125rem', fontFamily: 'var(--font-sans)', cursor: 'pointer',
};

const primaryBtnStyle: React.CSSProperties = {
    background: 'var(--accent-primary)', color: '#0A1628', border: 'none', borderRadius: 8,
    padding: '8px 20px', fontSize: '0.8125rem', fontWeight: 600, fontFamily: 'var(--font-sans)', cursor: 'pointer', transition: 'opacity 0.15s',
};

const smallBtnStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.06)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8,
    padding: '6px 14px', fontSize: '0.75rem', fontWeight: 500, fontFamily: 'var(--font-sans)', cursor: 'pointer', transition: 'all 0.15s',
};

const navArrowStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)', borderRadius: 8,
    padding: '6px 12px', color: 'var(--text-primary)', fontSize: '1rem', cursor: 'pointer', fontFamily: 'var(--font-sans)',
};

const sectionLabelStyle: React.CSSProperties = {
    fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8,
};

const thStyle: React.CSSProperties = {
    padding: '8px 12px', textAlign: 'left', fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em',
};

const tdStyle: React.CSSProperties = {
    padding: '8px 12px', color: 'var(--text-primary)',
};

function badgeStyle(color: string): React.CSSProperties {
    return {
        fontSize: '0.625rem', fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: `${color}22`, color, textTransform: 'capitalize',
    };
}

function LoadingDots() {
    return <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Loading...</span>;
}
