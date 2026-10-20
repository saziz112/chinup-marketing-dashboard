'use client';

import { useSession } from 'next-auth/react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
    ResearchTab, TABS, MONTH_NAMES,
    TrendTopic, FeedbackSummary,
    SocialTrendIG, SocialTrendYT, MarketData,
    CompetitorWatchData, ContentAnalysisData, TrafficSourceData,
    TrendScoutTab, MarketIntelTab,
} from '@/components/research/ResearchHelpers';
import { ContentResearchTab } from '@/components/research/ContentResearchTab';

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
    const [trafficError, setTrafficError] = useState<string | null>(null);
    const [competitorError, setCompetitorError] = useState<string | null>(null);

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
        setCompetitorError(null);
        fetch('/api/research/competitor-watch?location=all')
            .then(async r => {
                const d = await r.json();
                if (!r.ok) throw new Error(d.error || 'Competitor fetch failed');
                setCompetitorData(d);
            })
            .catch((e: Error) => setCompetitorError(e.message))
            .finally(() => setCompetitorLoading(false));

        // Content Performance Analysis
        fetch('/api/research/content-analysis')
            .then(r => r.json())
            .then(d => setContentAnalysis(d))
            .catch(() => {})
            .finally(() => setContentAnalysisLoading(false));

        // Traffic Sources (GA4)
        setTrafficError(null);
        fetch('/api/research/traffic-sources?days=30')
            .then(async r => {
                const d = await r.json();
                if (!r.ok) throw new Error(d.error || 'Traffic source fetch failed');
                setTrafficData(d);
            })
            .catch((e: Error) => setTrafficError(e.message))
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

            {activeTab === 'Viral Outliers' && <ContentResearchTab />}
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
            {activeTab === 'Market Intel' && (
                <MarketIntelTab
                    marketFetched={marketFetched}
                    fetchMarketIntel={fetchMarketIntel}
                    contentAnalysisLoading={contentAnalysisLoading}
                    contentAnalysis={contentAnalysis}
                    trafficLoading={trafficLoading}
                    trafficData={trafficData}
                    trafficError={trafficError}
                    competitorLoading={competitorLoading}
                    competitorData={competitorData}
                    competitorError={competitorError}
                    marketLoading={marketLoading}
                    marketData={marketData}
                />
            )}
        </div>
    );
}
