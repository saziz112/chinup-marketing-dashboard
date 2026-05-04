'use client';

import { useSession } from 'next-auth/react';
import { useState, useMemo, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
    ResearchTab, TABS, MONTH_NAMES,
    TrendTopic, FeedbackSummary, CalendarDay,
    SocialTrendIG, SocialTrendYT, MarketData,
    CompetitorWatchData, ContentAnalysisData, TrafficSourceData,
    TrendScoutTab, ContentCalendarTab, MarketIntelTab,
} from '@/components/research/ResearchHelpers';

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
            const text = await res.text();
            let data: any = {};
            try { data = text ? JSON.parse(text) : {}; } catch { /* non-JSON body (e.g. Vercel timeout page) */ }
            if (!res.ok) throw new Error(data.error || text.slice(0, 200) || `Failed to generate trends (${res.status})`);
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
            const text = await res.text();
            let data: any = {};
            try { data = text ? JSON.parse(text) : {}; } catch { /* non-JSON body (e.g. Vercel timeout page) */ }
            if (!res.ok) throw new Error(data.error || text.slice(0, 200) || `Failed to generate calendar (${res.status})`);
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

            {activeTab === 'Trend Scout' && (
                <TrendScoutTab
                    feedback={feedback}
                    selectedMonth={selectedMonth}
                    setSelectedMonth={setSelectedMonth}
                    selectedYear={selectedYear}
                    setSelectedYear={setSelectedYear}
                    trendFocus={trendFocus}
                    setTrendFocus={setTrendFocus}
                    generateTrends={generateTrends}
                    trendLoading={trendLoading}
                    trendLastGenerated={trendLastGenerated}
                    trendError={trendError}
                    trends={trends}
                />
            )}
            {activeTab === 'Content Calendar' && (
                <ContentCalendarTab
                    selectedMonth={selectedMonth}
                    selectedYear={selectedYear}
                    goMonth={goMonth}
                    generateCalendar={generateCalendar}
                    calendarLoading={calendarLoading}
                    calendarLoadingFromDB={calendarLoadingFromDB}
                    calendarDays={calendarDays}
                    calendarError={calendarError}
                    calendarLastGenerated={calendarLastGenerated}
                    expandedDay={expandedDay}
                    setExpandedDay={setExpandedDay}
                    queueLoading={queueLoading}
                    setQueueLoading={setQueueLoading}
                    queueResult={queueResult}
                    setQueueResult={setQueueResult}
                    setCalendarError={setCalendarError}
                    scheduledDates={scheduledDates}
                    setScheduledDates={setScheduledDates}
                    dayScheduleLoading={dayScheduleLoading}
                    setDayScheduleLoading={setDayScheduleLoading}
                    calendarGrid={calendarGrid}
                    calendarSummary={calendarSummary}
                    trends={trends}
                />
            )}
            {activeTab === 'Market Intel' && (
                <MarketIntelTab
                    marketFetched={marketFetched}
                    fetchMarketIntel={fetchMarketIntel}
                    contentAnalysisLoading={contentAnalysisLoading}
                    contentAnalysis={contentAnalysis}
                    trafficLoading={trafficLoading}
                    trafficData={trafficData}
                    competitorLoading={competitorLoading}
                    competitorData={competitorData}
                    marketLoading={marketLoading}
                    marketData={marketData}
                />
            )}
        </div>
    );
}
