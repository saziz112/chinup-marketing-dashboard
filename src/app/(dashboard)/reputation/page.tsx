'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
    BarChart, Bar, AreaChart, Area, LineChart, Line,
    RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { SkeletonKpiCard, SkeletonChart, SkeletonTable } from '@/components/Skeleton';
import { format } from 'date-fns';
import { formatNumber } from '@/lib/format';
import { TOOLTIP_STYLE } from '@/lib/constants';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const TABS = ['Reviews', 'Search Console', 'Competitors'] as const;
type TabType = typeof TABS[number];

const LOCATIONS = [
    { id: 'all', label: 'All Locations' },
    { id: 'atlanta', label: 'Atlanta' },
    { id: 'decatur', label: 'Decatur' },
    { id: 'kennesaw', label: 'Kennesaw' },
];

const REVIEWS_PER_PAGE = 5;

const STOPWORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
    'is', 'was', 'were', 'are', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did',
    'will', 'would', 'could', 'should', 'may', 'might', 'can', 'need',
    'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her',
    'it', 'its', 'they', 'them', 'their', 'what', 'which', 'who', 'this', 'that',
    'these', 'those', 'am', 'being', 'just', 'very', 'so', 'really', 'also', 'too',
    'not', 'no', 'here', 'there', 'when', 'where', 'how', 'all', 'each', 'every',
    'both', 'few', 'more', 'most', 'other', 'some', 'such', 'only', 'own', 'same',
    'than', 'from', 'up', 'about', 'into', 'like', 'by', 'after', 'before',
    'during', 'if', 'then', 'as', 'out', 'over', 'got', 'get', 'go', 'went',
    'make', 'made', 'come', 'came', 'know', 'take', 'see', 'think', 'tell',
    've', 're', 'll', 'm', 't', 's', 'd', 'don', 'doesn', 'didn', 'won',
]);

const RADAR_COLORS = ['#FFD700', '#60a5fa', '#4ade80'];
const STAR_COLORS: Record<number, string> = { 5: '#22c55e', 4: '#4ade80', 3: '#fbbf24', 2: '#f97316', 1: '#ef4444' };

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function StarRating({ rating }: { rating: number }) {
    const fullStars = Math.floor(rating);
    const hasHalf = rating % 1 >= 0.5;
    const emptyStars = 5 - fullStars - (hasHalf ? 1 : 0);
    return (
        <span style={{ color: '#FFD700', letterSpacing: '2px' }}>
            {'★'.repeat(fullStars)}
            {hasHalf ? '⯨' : ''}
            {'☆'.repeat(emptyStars)}
        </span>
    );
}

function extractKeywordThemes(reviews: any[]): { word: string; count: number }[] {
    const wordCounts = new Map<string, number>();
    for (const r of reviews) {
        if (!r.text) continue;
        const words = r.text.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/);
        for (const w of words) {
            if (w.length < 3 || STOPWORDS.has(w)) continue;
            wordCounts.set(w, (wordCounts.get(w) || 0) + 1);
        }
    }
    return Array.from(wordCounts.entries())
        .map(([word, count]) => ({ word, count }))
        .filter(e => e.count >= 2)
        .sort((a, b) => b.count - a.count)
        .slice(0, 12);
}

function getAiResponseSuggestion(rating: number, reviewerName: string): string {
    const firstName = reviewerName.split(' ')[0];
    if (rating <= 2) {
        return `Dear ${firstName}, we sincerely apologize for your experience. Your feedback is extremely important to us, and we'd love the opportunity to make this right. Please reach out to us directly so we can address your concerns personally. We're committed to providing the best possible care and service.`;
    }
    if (rating === 3) {
        return `Thank you for sharing your feedback, ${firstName}! We appreciate your honesty and are always looking for ways to improve. We'd love to hear more about how we can earn that 5-star experience for you next time. Please don't hesitate to reach out with any specific suggestions.`;
    }
    return '';
}

function getScoreLabel(score: number): { label: string; color: string } {
    if (score >= 80) return { label: 'Excellent', color: '#22c55e' };
    if (score >= 60) return { label: 'Good', color: '#4ade80' };
    if (score >= 40) return { label: 'Fair', color: '#fbbf24' };
    if (score >= 20) return { label: 'Needs Work', color: '#f97316' };
    return { label: 'Critical', color: '#ef4444' };
}

function downloadCSV(data: Record<string, any>[], filename: string) {
    if (!data.length) return;
    const headers = Object.keys(data[0]);
    const csv = [
        headers.join(','),
        ...data.map(row => headers.map(h => {
            const val = row[h] ?? '';
            const str = String(val).replace(/"/g, '""');
            return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str}"` : str;
        }).join(','))
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════

export default function ReputationPage() {
    const [activeTab, setActiveTab] = useState<TabType>('Reviews');
    const [locationId, setLocationId] = useState('all');
    const [locationDropdownOpen, setLocationDropdownOpen] = useState(false);
    const [reviewFilter, setReviewFilter] = useState<'Relevant' | 'Newest' | 'Lowest Rating' | 'Needs Reply'>('Relevant');
    const [reviewPage, setReviewPage] = useState(1);
    const [searchPeriod, setSearchPeriod] = useState(30);

    // Data states
    const [reviewsData, setReviewsData] = useState<any>(null);
    const [searchData, setSearchData] = useState<any>(null);
    const [compData, setCompData] = useState<any>(null);
    const [compNotes, setCompNotes] = useState<Record<string, { strengths: string[]; weaknesses: string[] }>>({});
    const [loading, setLoading] = useState(true);

    // Admin detection
    const [isAdmin, setIsAdmin] = useState(false);

    // Competitor editing state
    const [editingCompetitor, setEditingCompetitor] = useState<string | null>(null);
    const [editStrengths, setEditStrengths] = useState<string[]>([]);
    const [editWeaknesses, setEditWeaknesses] = useState<string[]>([]);

    // Check admin status
    useEffect(() => {
        fetch('/api/auth/session')
            .then(r => r.json())
            .then(s => setIsAdmin(s?.user?.isAdmin === true))
            .catch(() => {});
    }, []);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const query = locationId !== 'all' ? `?location=${locationId}` : '';
            const [revRes, searchRes, compRes, notesRes] = await Promise.all([
                fetch(`/api/reputation/reviews${query}`),
                fetch(`/api/reputation/search?period=${searchPeriod}`),
                fetch(`/api/reputation/competitors${query}`),
                fetch(`/api/reputation/competitor-notes?location=${locationId}`),
            ]);
            setReviewsData(await revRes.json());
            setSearchData(await searchRes.json());
            setCompData(await compRes.json());
            const notesJson = await notesRes.json();
            setCompNotes(notesJson.notes || {});
        } catch (e) {
            console.error('Failed to fetch reputation data', e);
        } finally {
            setLoading(false);
        }
    }, [locationId, searchPeriod]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Reset review page on filter/location change
    useEffect(() => { setReviewPage(1); }, [reviewFilter, locationId]);

    // ═══════════════════════════════════════════════════════════
    // REVIEWS TAB
    // ═══════════════════════════════════════════════════════════

    const filteredReviews = useMemo(() => {
        if (!reviewsData?.reviews) return [];
        let reviews = [...reviewsData.reviews];
        if (reviewFilter === 'Relevant') {
            reviews.sort((a: any, b: any) => {
                const lenA = a.text?.length || 0;
                const lenB = b.text?.length || 0;
                if (lenA === lenB) {
                    if (a.rating === b.rating) return new Date(b.date).getTime() - new Date(a.date).getTime();
                    return b.rating - a.rating;
                }
                return lenB - lenA;
            });
        } else if (reviewFilter === 'Newest') {
            reviews.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
        } else if (reviewFilter === 'Lowest Rating') {
            reviews.sort((a: any, b: any) => a.rating === b.rating ? new Date(b.date).getTime() - new Date(a.date).getTime() : a.rating - b.rating);
        } else if (reviewFilter === 'Needs Reply') {
            reviews = reviews.filter((r: any) => r.rating <= 3);
            reviews.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
        }
        return reviews;
    }, [reviewsData, reviewFilter]);

    const totalReviewPages = Math.ceil(filteredReviews.length / REVIEWS_PER_PAGE);
    const paginatedReviews = filteredReviews.slice((reviewPage - 1) * REVIEWS_PER_PAGE, reviewPage * REVIEWS_PER_PAGE);

    const ratingDistribution = useMemo(() => {
        if (!reviewsData?.reviews) return [];
        const counts: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
        for (const r of reviewsData.reviews) counts[r.rating] = (counts[r.rating] || 0) + 1;
        const total = reviewsData.reviews.length;
        return [5, 4, 3, 2, 1].map(star => ({
            star: `${star}★`,
            count: counts[star],
            pct: total > 0 ? Math.round((counts[star] / total) * 100) : 0,
        }));
    }, [reviewsData]);

    const keywordThemes = useMemo(() => extractKeywordThemes(reviewsData?.reviews || []), [reviewsData]);

    const monthlyVolume = useMemo(() => {
        if (!reviewsData?.reviews) return [];
        const monthMap = new Map<string, number>();
        for (const r of reviewsData.reviews) {
            const month = format(new Date(r.date), 'MMM yyyy');
            monthMap.set(month, (monthMap.get(month) || 0) + 1);
        }
        return Array.from(monthMap.entries())
            .map(([month, count]) => ({ month, count }))
            .sort((a, b) => new Date(a.month).getTime() - new Date(b.month).getTime());
    }, [reviewsData]);

    const renderReviewsTab = () => {
        if (!reviewsData) return null;
        const { metrics } = reviewsData;

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                {/* KPI Cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
                    <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
                        <div style={{ position: 'absolute', top: 0, right: 0, padding: '4px 12px', background: 'rgba(255,215,0,0.1)', color: '#FFD700', fontSize: '0.7rem', borderBottomLeftRadius: '8px', fontWeight: 600 }}>LIVE</div>
                        <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Google Rating</div>
                        <div style={{ fontSize: '2.5rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                            {Math.round(metrics.breakdown.google.rating * 10) / 10} <span style={{ fontSize: '1.5rem', color: '#FFD700' }}>★</span>
                        </div>
                    </div>
                    <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Total Reviews</div>
                        <div style={{ fontSize: '2.5rem', fontWeight: 600, color: 'var(--text-primary)' }}>{formatNumber(metrics.breakdown.google.count)}</div>
                    </div>
                    <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>5-Star Rate</div>
                        <div style={{ fontSize: '2.5rem', fontWeight: 600, color: '#22c55e' }}>
                            {ratingDistribution.length > 0 ? ratingDistribution[0].pct : 0}%
                        </div>
                    </div>
                    <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Needs Attention</div>
                        <div style={{ fontSize: '2.5rem', fontWeight: 600, color: (reviewsData.reviews?.filter((r: any) => r.rating <= 3).length || 0) > 0 ? '#f97316' : '#22c55e' }}>
                            {reviewsData.reviews?.filter((r: any) => r.rating <= 3).length || 0}
                        </div>
                    </div>
                </div>

                {/* Rating Distribution + Keyword Themes */}
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: '1.5rem' }}>
                    {/* Rating Distribution Chart */}
                    <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                        <h3 style={{ margin: '0 0 1rem 0', color: 'var(--text-primary)', fontSize: '1.1rem' }}>Rating Distribution</h3>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '-0.5rem 0 1rem 0' }}>Based on {reviewsData.reviews?.length || 0} recent Google reviews</p>
                        <ResponsiveContainer width="100%" height={200}>
                            <BarChart data={ratingDistribution} layout="vertical" margin={{ left: 10, right: 40, top: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                                <XAxis type="number" tick={{ fill: '#A1A1AA', fontSize: 11 }} domain={[0, 'auto']} />
                                <YAxis dataKey="star" type="category" width={40} tick={{ fill: '#A1A1AA', fontSize: 12 }} />
                                <Tooltip contentStyle={TOOLTIP_STYLE} />
                                <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={20}>
                                    {ratingDistribution.map((entry, i) => (
                                        <rect key={i} fill={STAR_COLORS[5 - i] || '#60a5fa'} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                        {/* Inline percentage labels */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '0.5rem' }}>
                            {ratingDistribution.map(d => (
                                <div key={d.star} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span style={{ width: '30px', textAlign: 'right', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{d.star}</span>
                                    <div style={{ flex: 1, height: '6px', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                                        <div style={{ width: `${d.pct}%`, height: '100%', backgroundColor: STAR_COLORS[parseInt(d.star)] || '#60a5fa', borderRadius: '3px', transition: 'width 0.5s ease' }} />
                                    </div>
                                    <span style={{ width: '35px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{d.pct}%</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Keyword Themes */}
                    <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                        <h3 style={{ margin: '0 0 1rem 0', color: 'var(--text-primary)', fontSize: '1.1rem' }}>Top Keywords</h3>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '-0.5rem 0 1rem 0' }}>Most mentioned words in reviews</p>
                        {keywordThemes.length === 0 ? (
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Not enough review text to extract themes.</p>
                        ) : (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                {keywordThemes.map(({ word, count }) => (
                                    <span key={word} style={{
                                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                                        padding: '4px 10px', borderRadius: '16px', fontSize: '0.8rem',
                                        backgroundColor: 'rgba(255,215,0,0.08)', color: 'var(--accent-color)',
                                        border: '1px solid rgba(255,215,0,0.15)',
                                    }}>
                                        {word} <span style={{ opacity: 0.6, fontSize: '0.7rem' }}>({count})</span>
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Monthly Review Volume */}
                {monthlyVolume.length > 1 && (
                    <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                        <h3 style={{ margin: '0 0 1rem 0', color: 'var(--text-primary)', fontSize: '1.1rem' }}>Review Volume by Month</h3>
                        <ResponsiveContainer width="100%" height={160}>
                            <BarChart data={monthlyVolume} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                <XAxis dataKey="month" tick={{ fill: '#A1A1AA', fontSize: 11 }} />
                                <YAxis tick={{ fill: '#A1A1AA', fontSize: 11 }} allowDecimals={false} />
                                <Tooltip contentStyle={TOOLTIP_STYLE} />
                                <Bar dataKey="count" name="Reviews" fill="#FFD700" radius={[4, 4, 0, 0]} maxBarSize={40} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                )}

                {/* Review Feed */}
                <div style={{ backgroundColor: 'var(--card-bg)', padding: '2rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                        <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.4rem' }}>Recent Reviews</h3>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                            {['Relevant', 'Newest', 'Lowest Rating', 'Needs Reply'].map(f => (
                                <button
                                    key={f}
                                    onClick={() => setReviewFilter(f as any)}
                                    style={{
                                        padding: '0.5rem 1rem',
                                        backgroundColor: reviewFilter === f ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                                        color: reviewFilter === f ? '#fff' : 'var(--text-muted)',
                                        border: `1px solid ${reviewFilter === f ? 'rgba(255, 255, 255, 0.2)' : 'var(--border-color)'}`,
                                        borderRadius: '20px', cursor: 'pointer', fontSize: '0.85rem',
                                        transition: 'all 0.2s', fontWeight: reviewFilter === f ? 600 : 400,
                                    }}
                                >
                                    {f}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                        {paginatedReviews.length === 0 ? (
                            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>No reviews match this filter.</div>
                        ) : paginatedReviews.map((req: any, i: number) => (
                            <div key={`${req.platform}-${req.id}-${i}`} style={{ backgroundColor: 'var(--bg-color)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                        {req.avatarUrl ? (
                                            <img src={req.avatarUrl} alt="avatar" style={{ width: '40px', height: '40px', borderRadius: '50%' }} />
                                        ) : (
                                            <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                                                {req.reviewerName.charAt(0)}
                                            </div>
                                        )}
                                        <div>
                                            <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{req.reviewerName}</div>
                                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>via {req.platform}</span>
                                        </div>
                                    </div>
                                    <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                                        {format(new Date(req.date), 'MMM d, yyyy')}
                                    </div>
                                </div>
                                <div style={{ margin: '12px 0' }}><StarRating rating={req.rating} /></div>
                                <p style={{ color: 'var(--text-primary)', lineHeight: 1.6, margin: 0 }}>"{req.text}"</p>

                                {/* AI Response Suggestion for low-rated reviews */}
                                {req.rating <= 3 && (
                                    <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: 'rgba(251, 191, 36, 0.05)', borderRadius: '8px', border: '1px solid rgba(251, 191, 36, 0.15)' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '0.5rem' }}>
                                            <span style={{ fontSize: '0.9rem' }}>💡</span>
                                            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#fbbf24' }}>Suggested Response</span>
                                        </div>
                                        <p style={{ color: 'var(--text-primary)', fontSize: '0.85rem', lineHeight: 1.5, margin: 0, fontStyle: 'italic' }}>
                                            "{getAiResponseSuggestion(req.rating, req.reviewerName)}"
                                        </p>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Pagination */}
                    {totalReviewPages > 1 && (
                        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', marginTop: '1.5rem' }}>
                            <button
                                onClick={() => setReviewPage(p => Math.max(1, p - 1))}
                                disabled={reviewPage <= 1}
                                style={{ padding: '0.5rem 1rem', backgroundColor: 'var(--bg-color)', color: reviewPage <= 1 ? 'var(--text-muted)' : 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '8px', cursor: reviewPage <= 1 ? 'default' : 'pointer', opacity: reviewPage <= 1 ? 0.5 : 1 }}
                            >
                                Previous
                            </button>
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                                Page {reviewPage} of {totalReviewPages}
                            </span>
                            <button
                                onClick={() => setReviewPage(p => Math.min(totalReviewPages, p + 1))}
                                disabled={reviewPage >= totalReviewPages}
                                style={{ padding: '0.5rem 1rem', backgroundColor: 'var(--bg-color)', color: reviewPage >= totalReviewPages ? 'var(--text-muted)' : 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '8px', cursor: reviewPage >= totalReviewPages ? 'default' : 'pointer', opacity: reviewPage >= totalReviewPages ? 0.5 : 1 }}
                            >
                                Next
                            </button>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    // ═══════════════════════════════════════════════════════════
    // SEARCH CONSOLE TAB
    // ═══════════════════════════════════════════════════════════

    const renderSearchTab = () => {
        if (!searchData) return null;

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                {!searchData.isConfigured && (
                    <div style={{ backgroundColor: 'var(--card-bg)', padding: '1rem 1.5rem', borderRadius: '12px', border: '1px solid #f59e0b44', display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ fontSize: '1.2rem' }}>⚠️</span>
                        <div>
                            <strong style={{ color: '#f59e0b', fontSize: '1rem' }}>Connect Google Search Console</strong>
                            <p style={{ margin: '4px 0 0 0', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                                Add Service Account JSON credentials to <code style={{ color: 'var(--accent-color)' }}>.env.local</code> to view live search performance.
                            </p>
                        </div>
                    </div>
                )}

                {/* Period Selector */}
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {[7, 30, 90].map(p => (
                        <button
                            key={p}
                            onClick={() => setSearchPeriod(p)}
                            style={{
                                padding: '0.5rem 1.25rem',
                                backgroundColor: searchPeriod === p ? 'rgba(255, 215, 0, 0.1)' : 'transparent',
                                color: searchPeriod === p ? 'var(--accent-color)' : 'var(--text-muted)',
                                border: `1px solid ${searchPeriod === p ? 'var(--accent-color)' : 'var(--border-color)'}`,
                                borderRadius: '20px', cursor: 'pointer', fontSize: '0.85rem',
                                fontWeight: searchPeriod === p ? 600 : 400, transition: 'all 0.2s',
                            }}
                        >
                            {p}d
                        </button>
                    ))}
                </div>

                {/* KPI Cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
                    <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                        <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Total Clicks</div>
                        <div style={{ fontSize: '2rem', fontWeight: 600, color: 'var(--text-primary)' }}>{formatNumber(searchData.totals.clicks)}</div>
                    </div>
                    <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                        <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Total Impressions</div>
                        <div style={{ fontSize: '2rem', fontWeight: 600, color: 'var(--text-primary)' }}>{formatNumber(searchData.totals.impressions)}</div>
                    </div>
                    <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                        <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Average CTR</div>
                        <div style={{ fontSize: '2rem', fontWeight: 600, color: 'var(--text-primary)' }}>{(searchData.totals.ctr * 100).toFixed(2)}%</div>
                    </div>
                    <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                        <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Avg Position</div>
                        <div style={{ fontSize: '2rem', fontWeight: 600, color: 'var(--text-primary)' }}>{searchData.totals.position.toFixed(1)}</div>
                        {/* Position sparkline */}
                        {searchData.dailyMetrics?.length > 2 && (
                            <div style={{ height: '30px', marginTop: '4px' }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={searchData.dailyMetrics.slice(-14)}>
                                        <Line type="monotone" dataKey="position" stroke="#60a5fa" strokeWidth={1.5} dot={false} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '2px' }}>Lower is better</div>
                    </div>
                </div>

                {/* Clicks & Impressions Trend Chart */}
                {searchData.dailyMetrics?.length > 0 && (
                    <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                        <h3 style={{ margin: '0 0 1rem 0', color: 'var(--text-primary)', fontSize: '1.1rem' }}>Clicks & Impressions Trend</h3>
                        <ResponsiveContainer width="100%" height={280}>
                            <AreaChart data={searchData.dailyMetrics} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                                <defs>
                                    <linearGradient id="clicksGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#FFD700" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#FFD700" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="impressionsGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#60a5fa" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                <XAxis dataKey="date" tick={{ fill: '#A1A1AA', fontSize: 11 }} tickFormatter={(d) => format(new Date(d), 'MMM d')} interval="preserveStartEnd" />
                                <YAxis yAxisId="left" tick={{ fill: '#A1A1AA', fontSize: 11 }} tickFormatter={(v) => formatNumber(v)} />
                                <YAxis yAxisId="right" orientation="right" tick={{ fill: '#A1A1AA', fontSize: 11 }} tickFormatter={(v) => formatNumber(v)} />
                                <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(d) => format(new Date(d), 'MMM d, yyyy')} />
                                <Legend wrapperStyle={{ color: '#E4E4E7', fontSize: '0.8125rem' }} />
                                <Area yAxisId="left" type="monotone" dataKey="clicks" name="Clicks" stroke="#FFD700" fill="url(#clicksGrad)" strokeWidth={2} dot={false} />
                                <Area yAxisId="right" type="monotone" dataKey="impressions" name="Impressions" stroke="#60a5fa" fill="url(#impressionsGrad)" strokeWidth={2} dot={false} />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                )}

                {/* Top Search Queries */}
                <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                    <h3 style={{ marginBottom: '1rem', color: 'var(--text-primary)' }}>Top Search Queries</h3>
                    <div className="data-table-wrapper">
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left' }}>
                                    <th style={{ padding: '1rem 0', color: 'var(--text-muted)', fontWeight: 500 }}>Query</th>
                                    <th style={{ padding: '1rem 0', color: 'var(--text-muted)', fontWeight: 500 }}>Clicks</th>
                                    <th style={{ padding: '1rem 0', color: 'var(--text-muted)', fontWeight: 500 }}>Impressions</th>
                                    <th style={{ padding: '1rem 0', color: 'var(--text-muted)', fontWeight: 500 }}>CTR</th>
                                    <th style={{ padding: '1rem 0', color: 'var(--text-muted)', fontWeight: 500 }}>Position</th>
                                </tr>
                            </thead>
                            <tbody>
                                {searchData.topQueries?.map((q: any) => (
                                    <tr key={q.query} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                        <td style={{ padding: '1rem 0', color: 'var(--text-primary)', fontWeight: 500 }}>{q.query}</td>
                                        <td style={{ padding: '1rem 0', color: 'var(--text-primary)' }}>{q.clicks}</td>
                                        <td style={{ padding: '1rem 0', color: 'var(--text-primary)' }}>{formatNumber(q.impressions)}</td>
                                        <td style={{ padding: '1rem 0', color: 'var(--accent-color)' }}>{(q.ctr * 100).toFixed(1)}%</td>
                                        <td style={{ padding: '1rem 0', color: 'var(--text-primary)' }}>{q.position.toFixed(1)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Top Pages Table */}
                {searchData.topPages?.length > 0 && (
                    <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                        <h3 style={{ marginBottom: '1rem', color: 'var(--text-primary)' }}>Top Landing Pages</h3>
                        <div className="data-table-wrapper">
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left' }}>
                                        <th style={{ padding: '1rem 0', color: 'var(--text-muted)', fontWeight: 500 }}>Page</th>
                                        <th style={{ padding: '1rem 0', color: 'var(--text-muted)', fontWeight: 500 }}>Clicks</th>
                                        <th style={{ padding: '1rem 0', color: 'var(--text-muted)', fontWeight: 500 }}>Impressions</th>
                                        <th style={{ padding: '1rem 0', color: 'var(--text-muted)', fontWeight: 500 }}>CTR</th>
                                        <th style={{ padding: '1rem 0', color: 'var(--text-muted)', fontWeight: 500 }}>Position</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {searchData.topPages.map((p: any) => {
                                        const shortUrl = p.page.replace(/^https?:\/\//, '').replace(/\/$/, '');
                                        return (
                                            <tr key={p.page} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                <td style={{ padding: '1rem 0', color: 'var(--accent-color)', fontWeight: 500, maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {shortUrl}
                                                </td>
                                                <td style={{ padding: '1rem 0', color: 'var(--text-primary)' }}>{p.clicks}</td>
                                                <td style={{ padding: '1rem 0', color: 'var(--text-primary)' }}>{formatNumber(p.impressions)}</td>
                                                <td style={{ padding: '1rem 0', color: 'var(--accent-color)' }}>{(p.ctr * 100).toFixed(1)}%</td>
                                                <td style={{ padding: '1rem 0', color: 'var(--text-primary)' }}>{p.position.toFixed(1)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    // ═══════════════════════════════════════════════════════════
    // COMPETITORS TAB
    // ═══════════════════════════════════════════════════════════

    const competitorScores = useMemo(() => {
        if (!compData?.competitors) return [];
        const comps = compData.competitors;
        const maxReviews = Math.max(...comps.map((c: any) => c.reviewCount || 0));
        const maxFollowers = Math.max(...comps.map((c: any) => c.followersCount || 0));
        const maxMedia = Math.max(...comps.map((c: any) => c.mediaCount || 0));
        const maxEngagement = Math.max(...comps.map((c: any) => c.avgEngagementRate || 0));

        return comps.map((c: any) => {
            const ratingScore = ((c.averageRating || 0) / 5) * 100;
            const reviewScore = maxReviews > 0 ? ((c.reviewCount || 0) / maxReviews) * 100 : 0;
            const followerScore = maxFollowers > 0 ? ((c.followersCount || 0) / maxFollowers) * 100 : 0;
            const contentScore = maxMedia > 0 ? ((c.mediaCount || 0) / maxMedia) * 100 : 0;
            const engagementScore = maxEngagement > 0 ? ((c.avgEngagementRate || 0) / maxEngagement) * 100 : 0;
            // Include engagement in score if available
            const hasEngagement = maxEngagement > 0;
            const score = hasEngagement
                ? Math.round(ratingScore * 0.3 + reviewScore * 0.15 + followerScore * 0.15 + contentScore * 0.15 + engagementScore * 0.25)
                : Math.round(ratingScore * 0.4 + reviewScore * 0.2 + followerScore * 0.2 + contentScore * 0.2);
            return { ...c, calculatedScore: score };
        });
    }, [compData]);

    const radarData = useMemo(() => {
        if (competitorScores.length === 0) return [];
        const maxReviews = Math.max(...competitorScores.map((c: any) => c.reviewCount || 0));
        const maxFollowers = Math.max(...competitorScores.map((c: any) => c.followersCount || 0));
        const maxMedia = Math.max(...competitorScores.map((c: any) => c.mediaCount || 0));

        const maxEngagement = Math.max(...competitorScores.map((c: any) => c.avgEngagementRate || 0));
        const maxPostFreq = Math.max(...competitorScores.map((c: any) => c.postingFrequency || 0));

        const metrics = [
            { label: 'Rating', getValue: (c: any) => Math.round(((c.averageRating || 0) / 5) * 100) },
            { label: 'Reviews', getValue: (c: any) => maxReviews > 0 ? Math.round(((c.reviewCount || 0) / maxReviews) * 100) : 0 },
            { label: 'Followers', getValue: (c: any) => maxFollowers > 0 ? Math.round(((c.followersCount || 0) / maxFollowers) * 100) : 0 },
            { label: 'Content', getValue: (c: any) => maxMedia > 0 ? Math.round(((c.mediaCount || 0) / maxMedia) * 100) : 0 },
            ...(maxEngagement > 0 ? [{ label: 'Engagement', getValue: (c: any) => maxEngagement > 0 ? Math.round(((c.avgEngagementRate || 0) / maxEngagement) * 100) : 0 }] : []),
            ...(maxPostFreq > 0 ? [{ label: 'Post Frequency', getValue: (c: any) => maxPostFreq > 0 ? Math.round(((c.postingFrequency || 0) / maxPostFreq) * 100) : 0 }] : []),
        ];

        return metrics.map(m => {
            const entry: Record<string, any> = { metric: m.label };
            competitorScores.forEach((c: any) => {
                entry[c.id] = m.getValue(c);
            });
            return entry;
        });
    }, [competitorScores]);

    const handleSaveNotes = async (competitorId: string) => {
        try {
            await fetch('/api/reputation/competitor-notes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    location: locationId,
                    competitorId,
                    strengths: editStrengths.filter(s => s.trim()),
                    weaknesses: editWeaknesses.filter(w => w.trim()),
                }),
            });
            setCompNotes(prev => ({
                ...prev,
                [competitorId]: {
                    strengths: editStrengths.filter(s => s.trim()),
                    weaknesses: editWeaknesses.filter(w => w.trim()),
                },
            }));
            setEditingCompetitor(null);
        } catch (e) {
            console.error('Failed to save competitor notes', e);
        }
    };

    const renderCompetitorsTab = () => {
        if (!compData) return null;

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                {/* Actionable Feedback */}
                <div style={{ backgroundColor: 'var(--card-bg)', borderRadius: '12px', border: '1px solid var(--accent-color)', padding: '2rem', position: 'relative', overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', top: 0, left: 0, width: '4px', height: '100%', backgroundColor: 'var(--accent-color)' }} />
                    <h3 style={{ marginTop: 0, marginBottom: '0.5rem', color: 'var(--text-primary)', fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span>💡</span> Actionable Feedback
                    </h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>Strategic recommendations based on competitive landscape analysis.</p>
                    <ul style={{ margin: 0, paddingLeft: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        {compData.competitors[0]?.feedback?.map((fb: string, i: number) => (
                            <li key={i} style={{ color: 'var(--text-primary)', lineHeight: 1.5, fontSize: '1rem' }}>{fb}</li>
                        ))}
                    </ul>
                </div>

                {/* Radar Chart */}
                {radarData.length > 0 && (
                    <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                        <h3 style={{ margin: '0 0 1rem 0', color: 'var(--text-primary)', fontSize: '1.2rem' }}>Competitive Comparison</h3>
                        <ResponsiveContainer width="100%" height={350}>
                            <RadarChart data={radarData}>
                                <PolarGrid stroke="rgba(255,255,255,0.1)" />
                                <PolarAngleAxis dataKey="metric" tick={{ fill: '#A1A1AA', fontSize: 12 }} />
                                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                                {competitorScores.map((c: any, i: number) => (
                                    <Radar
                                        key={c.id}
                                        name={c.name}
                                        dataKey={c.id}
                                        stroke={RADAR_COLORS[i % RADAR_COLORS.length]}
                                        fill={RADAR_COLORS[i % RADAR_COLORS.length]}
                                        fillOpacity={0.15}
                                        strokeWidth={2}
                                    />
                                ))}
                                <Legend wrapperStyle={{ color: '#E4E4E7', fontSize: '0.8125rem' }} />
                                <Tooltip contentStyle={TOOLTIP_STYLE} />
                            </RadarChart>
                        </ResponsiveContainer>
                    </div>
                )}

                {/* Competitor Cards */}
                <div style={{ backgroundColor: 'var(--card-bg)', borderRadius: '12px', border: '1px solid var(--border-color)', padding: '2rem' }}>
                    <h3 style={{ marginTop: 0, marginBottom: '2rem', color: 'var(--text-primary)', fontSize: '1.2rem' }}>Competitor Profiles</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem' }}>
                        {competitorScores.map((c: any) => {
                            const { label: scoreLabel, color: scoreColor } = getScoreLabel(c.calculatedScore);
                            const savedNotes = compNotes[c.id];
                            const strengths = savedNotes?.strengths?.length ? savedNotes.strengths : c.strengths || [];
                            const weaknesses = savedNotes?.weaknesses?.length ? savedNotes.weaknesses : c.weaknesses || [];
                            const isEditing = editingCompetitor === c.id;

                            return (
                                <div key={c.id} style={{ border: '1px solid var(--border-color)', padding: '1.5rem', borderRadius: '12px', backgroundColor: 'var(--bg-color)' }}>
                                    {/* Header */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
                                        <div style={{ width: '40px', height: '40px', backgroundColor: c.isOurBusiness ? 'var(--accent-color)' : '#475569', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: c.isOurBusiness ? '#000' : '#fff', fontWeight: 600, fontSize: '0.8rem', flexShrink: 0 }}>
                                            {c.name.substring(0, 2).toUpperCase()}
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                                                {c.isOurBusiness && <span style={{ fontSize: '0.65rem', background: 'rgba(255,215,0,0.1)', color: 'var(--accent-color)', padding: '2px 6px', borderRadius: '4px', whiteSpace: 'nowrap' }}>Your Business</span>}
                                            </div>
                                            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{formatNumber(c.reviewCount)} reviews</div>
                                        </div>
                                    </div>

                                    {/* Score + Rating */}
                                    <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
                                        <div style={{ textAlign: 'center', padding: '0.75rem', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: '8px', flex: 1 }}>
                                            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: scoreColor }}>{c.calculatedScore}</div>
                                            <div style={{ fontSize: '0.7rem', color: scoreColor, fontWeight: 600 }}>{scoreLabel}</div>
                                        </div>
                                        <div style={{ textAlign: 'center', padding: '0.75rem', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: '8px', flex: 1 }}>
                                            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>{c.averageRating}<span style={{ fontSize: '0.9rem', color: '#FFD700' }}>★</span></div>
                                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Rating</div>
                                        </div>
                                        <div style={{ textAlign: 'center', padding: '0.75rem', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: '8px', flex: 1 }}>
                                            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>{formatNumber(c.followersCount)}</div>
                                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Followers</div>
                                        </div>
                                    </div>

                                    {/* Engagement Metrics (if available) */}
                                    {c.avgEngagementRate != null && (
                                        <div style={{ marginBottom: '1.5rem' }}>
                                            <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>Engagement</div>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', marginBottom: '0.75rem' }}>
                                                <div style={{ textAlign: 'center', padding: '0.5rem', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: '6px' }}>
                                                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: c.avgEngagementRate > 0.03 ? '#4ade80' : c.avgEngagementRate > 0.01 ? '#fbbf24' : '#f87171' }}>
                                                        {(c.avgEngagementRate * 100).toFixed(1)}%
                                                    </div>
                                                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Eng. Rate</div>
                                                </div>
                                                <div style={{ textAlign: 'center', padding: '0.5rem', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: '6px' }}>
                                                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                                                        {c.postingFrequency?.toFixed(1) ?? '—'}/wk
                                                    </div>
                                                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Post Freq</div>
                                                </div>
                                                <div style={{ textAlign: 'center', padding: '0.5rem', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: '6px' }}>
                                                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: c.engagementTrend === 'growing' ? '#4ade80' : c.engagementTrend === 'declining' ? '#f87171' : '#fbbf24' }}>
                                                        {c.engagementTrend === 'growing' ? 'Up' : c.engagementTrend === 'declining' ? 'Down' : 'Flat'}
                                                    </div>
                                                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Trend</div>
                                                </div>
                                            </div>
                                            {/* Content Mix */}
                                            {c.contentMix && (
                                                <div style={{ marginBottom: '0.75rem' }}>
                                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Content Mix</div>
                                                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                                                        {c.contentMix.videos > 0 && (
                                                            <span style={{ fontSize: '0.7rem', color: '#c084fc', background: 'rgba(192, 132, 252, 0.1)', padding: '2px 8px', borderRadius: '12px', border: '1px solid rgba(192, 132, 252, 0.2)' }}>
                                                                Reels {Math.round((c.contentMix.videos / (c.contentMix.images + c.contentMix.videos + c.contentMix.carousels)) * 100)}%
                                                            </span>
                                                        )}
                                                        {c.contentMix.images > 0 && (
                                                            <span style={{ fontSize: '0.7rem', color: '#60a5fa', background: 'rgba(96, 165, 250, 0.1)', padding: '2px 8px', borderRadius: '12px', border: '1px solid rgba(96, 165, 250, 0.2)' }}>
                                                                Images {Math.round((c.contentMix.images / (c.contentMix.images + c.contentMix.videos + c.contentMix.carousels)) * 100)}%
                                                            </span>
                                                        )}
                                                        {c.contentMix.carousels > 0 && (
                                                            <span style={{ fontSize: '0.7rem', color: '#fbbf24', background: 'rgba(251, 191, 36, 0.1)', padding: '2px 8px', borderRadius: '12px', border: '1px solid rgba(251, 191, 36, 0.2)' }}>
                                                                Carousels {Math.round((c.contentMix.carousels / (c.contentMix.images + c.contentMix.videos + c.contentMix.carousels)) * 100)}%
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                            {/* Top Hashtags */}
                                            {c.topHashtags?.length > 0 && (
                                                <div style={{ marginBottom: '0.75rem' }}>
                                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Top Hashtags</div>
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                                                        {c.topHashtags.slice(0, 6).map((ht: any, i: number) => (
                                                            <span key={i} style={{ fontSize: '0.68rem', color: '#38bdf8', background: 'rgba(56, 189, 248, 0.08)', padding: '2px 6px', borderRadius: '10px' }}>
                                                                {ht.tag} ({ht.count})
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                            {/* Best Post */}
                                            {c.bestPost && (
                                                <div style={{ padding: '0.5rem', backgroundColor: 'rgba(255,215,0,0.05)', borderRadius: '8px', border: '1px solid rgba(255,215,0,0.15)' }}>
                                                    <div style={{ fontSize: '0.7rem', color: 'var(--accent-color)', fontWeight: 600, marginBottom: '3px' }}>Best Performing Post</div>
                                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-primary)', lineHeight: 1.4 }}>
                                                        {c.bestPost.caption?.substring(0, 100)}{c.bestPost.caption?.length > 100 ? '...' : ''}
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '0.75rem', marginTop: '4px', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                                        <span>{formatNumber(c.bestPost.likeCount)} likes</span>
                                                        <span>{formatNumber(c.bestPost.commentsCount)} comments</span>
                                                        <span style={{ color: '#4ade80' }}>{(c.bestPost.engagementRate * 100).toFixed(1)}% eng</span>
                                                    </div>
                                                    {c.bestPost.permalink && (
                                                        <a href={c.bestPost.permalink} target="_blank" rel="noopener noreferrer"
                                                            style={{ fontSize: '0.68rem', color: '#60a5fa', textDecoration: 'none', marginTop: '4px', display: 'inline-block' }}>
                                                            View on Instagram →
                                                        </a>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Viral Posts Alert */}
                                    {c.viralPosts?.length > 0 && (
                                        <div style={{ marginBottom: '1.5rem', padding: '0.75rem', backgroundColor: 'rgba(239, 68, 68, 0.06)', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                                            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#f87171', marginBottom: '0.5rem' }}>
                                                Viral Content ({c.viralPosts.length} post{c.viralPosts.length > 1 ? 's' : ''})
                                            </div>
                                            {c.viralPosts.slice(0, 2).map((vp: any, i: number) => (
                                                <div key={i} style={{ marginBottom: i < c.viralPosts.length - 1 ? '0.5rem' : 0, paddingBottom: i < c.viralPosts.length - 1 ? '0.5rem' : 0, borderBottom: i < c.viralPosts.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-primary)', lineHeight: 1.3 }}>
                                                        {vp.caption?.substring(0, 80)}{vp.caption?.length > 80 ? '...' : ''}
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '3px', fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                                                        <span>{formatNumber(vp.likeCount)} likes</span>
                                                        <span>{formatNumber(vp.commentsCount)} comments</span>
                                                        <span style={{ color: '#f87171', fontWeight: 600 }}>{vp.multiplier}x avg</span>
                                                        <span>{vp.mediaType === 'VIDEO' ? 'Reel' : vp.mediaType === 'CAROUSEL_ALBUM' ? 'Carousel' : 'Image'}</span>
                                                    </div>
                                                    {vp.permalink && (
                                                        <a href={vp.permalink} target="_blank" rel="noopener noreferrer"
                                                            style={{ fontSize: '0.65rem', color: '#60a5fa', textDecoration: 'none', marginTop: '2px', display: 'inline-block' }}>
                                                            View →
                                                        </a>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* Strengths */}
                                    <div style={{ marginBottom: '1rem' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                            <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.85rem' }}>Strengths</div>
                                            {isAdmin && !isEditing && (
                                                <button onClick={() => { setEditingCompetitor(c.id); setEditStrengths([...strengths]); setEditWeaknesses([...weaknesses]); }}
                                                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.75rem', padding: '2px 6px' }}>
                                                    Edit
                                                </button>
                                            )}
                                        </div>
                                        {isEditing ? (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                {editStrengths.map((s, i) => (
                                                    <div key={i} style={{ display: 'flex', gap: '4px' }}>
                                                        <input value={s} onChange={e => { const u = [...editStrengths]; u[i] = e.target.value; setEditStrengths(u); }}
                                                            style={{ flex: 1, padding: '4px 8px', backgroundColor: 'var(--card-bg)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', fontSize: '0.8rem' }} />
                                                        <button onClick={() => setEditStrengths(editStrengths.filter((_, j) => j !== i))}
                                                            style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '1rem', padding: '0 4px' }}>x</button>
                                                    </div>
                                                ))}
                                                <button onClick={() => setEditStrengths([...editStrengths, ''])}
                                                    style={{ background: 'none', border: '1px dashed var(--border-color)', color: 'var(--text-muted)', cursor: 'pointer', borderRadius: '4px', padding: '4px', fontSize: '0.75rem' }}>+ Add</button>
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                                                {strengths.map((str: string, i: number) => (
                                                    <span key={i} style={{ fontSize: '0.75rem', color: '#4ade80', background: 'rgba(74, 222, 128, 0.1)', padding: '3px 8px', borderRadius: '12px', border: '1px solid rgba(74, 222, 128, 0.2)' }}>
                                                        {str}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    {/* Weaknesses */}
                                    <div style={{ marginBottom: isEditing ? '1rem' : 0 }}>
                                        <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>Weaknesses</div>
                                        {isEditing ? (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                {editWeaknesses.map((w, i) => (
                                                    <div key={i} style={{ display: 'flex', gap: '4px' }}>
                                                        <input value={w} onChange={e => { const u = [...editWeaknesses]; u[i] = e.target.value; setEditWeaknesses(u); }}
                                                            style={{ flex: 1, padding: '4px 8px', backgroundColor: 'var(--card-bg)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', fontSize: '0.8rem' }} />
                                                        <button onClick={() => setEditWeaknesses(editWeaknesses.filter((_, j) => j !== i))}
                                                            style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '1rem', padding: '0 4px' }}>x</button>
                                                    </div>
                                                ))}
                                                <button onClick={() => setEditWeaknesses([...editWeaknesses, ''])}
                                                    style={{ background: 'none', border: '1px dashed var(--border-color)', color: 'var(--text-muted)', cursor: 'pointer', borderRadius: '4px', padding: '4px', fontSize: '0.75rem' }}>+ Add</button>
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                                                {weaknesses.map((wk: string, i: number) => (
                                                    <span key={i} style={{ fontSize: '0.75rem', color: '#f87171', background: 'rgba(248, 113, 113, 0.1)', padding: '3px 8px', borderRadius: '12px', border: '1px solid rgba(248, 113, 113, 0.2)' }}>
                                                        {wk}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    {/* Save/Cancel for editing */}
                                    {isEditing && (
                                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                            <button onClick={() => setEditingCompetitor(null)}
                                                style={{ padding: '6px 16px', backgroundColor: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border-color)', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem' }}>
                                                Cancel
                                            </button>
                                            <button onClick={() => handleSaveNotes(c.id)}
                                                style={{ padding: '6px 16px', backgroundColor: 'var(--accent-color)', color: '#000', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}>
                                                Save
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        );
    };

    // ═══════════════════════════════════════════════════════════
    // EXPORT HANDLER
    // ═══════════════════════════════════════════════════════════

    const handleExport = () => {
        if (activeTab === 'Reviews' && reviewsData?.reviews) {
            downloadCSV(
                reviewsData.reviews.map((r: any) => ({ Reviewer: r.reviewerName, Rating: r.rating, Date: r.date, Text: r.text, Platform: r.platform })),
                `reviews_${locationId}_${format(new Date(), 'yyyy-MM-dd')}.csv`
            );
        } else if (activeTab === 'Search Console' && searchData?.topQueries) {
            downloadCSV(
                searchData.topQueries.map((q: any) => ({ Query: q.query, Clicks: q.clicks, Impressions: q.impressions, CTR: (q.ctr * 100).toFixed(1) + '%', Position: q.position.toFixed(1) })),
                `search_queries_${searchPeriod}d_${format(new Date(), 'yyyy-MM-dd')}.csv`
            );
        } else if (activeTab === 'Competitors' && competitorScores.length > 0) {
            downloadCSV(
                competitorScores.map((c: any) => ({ Name: c.name, Rating: c.averageRating, Reviews: c.reviewCount, Followers: c.followersCount, Media: c.mediaCount, Score: c.calculatedScore })),
                `competitors_${locationId}_${format(new Date(), 'yyyy-MM-dd')}.csv`
            );
        }
    };

    // ═══════════════════════════════════════════════════════════
    // LAYOUT
    // ═══════════════════════════════════════════════════════════

    return (
        <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                    <h1 style={{ fontSize: '2rem', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 0.5rem 0' }}>Reputation Management</h1>
                    <p style={{ color: 'var(--text-muted)', margin: 0 }}>Monitor reviews, search visibility, and competitor performance.</p>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    {/* Refresh Button */}
                    <button
                        onClick={() => fetchData()}
                        title="Refresh data"
                        style={{ padding: '0.6rem', backgroundColor: 'var(--card-bg)', color: 'var(--text-muted)', border: '1px solid var(--border-color)', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'color 0.2s' }}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3" /></svg>
                    </button>

                    {/* Export CSV Button */}
                    <button
                        onClick={handleExport}
                        title="Export CSV"
                        style={{ padding: '0.6rem', backgroundColor: 'var(--card-bg)', color: 'var(--text-muted)', border: '1px solid var(--border-color)', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'color 0.2s' }}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
                    </button>

                    {/* Location Picker */}
                    <div style={{ position: 'relative' }}>
                        <button
                            onClick={() => setLocationDropdownOpen(!locationDropdownOpen)}
                            style={{ padding: '0.6rem 1rem', backgroundColor: 'var(--card-bg)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '8px', fontSize: '0.9rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: '150px', justifyContent: 'space-between' }}
                        >
                            {LOCATIONS.find(l => l.id === locationId)?.label || 'All Locations'}
                            <span style={{ fontSize: '0.8rem' }}>▼</span>
                        </button>

                        {locationDropdownOpen && (
                            <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '0.5rem', backgroundColor: '#1a2332', border: '1px solid var(--border-color)', borderRadius: '8px', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.6)', zIndex: 50, minWidth: '150px', overflow: 'hidden' }}>
                                {LOCATIONS.map(loc => (
                                    <div
                                        key={loc.id}
                                        onClick={() => { setLocationId(loc.id); setLocationDropdownOpen(false); }}
                                        style={{ padding: '0.75rem 1rem', cursor: 'pointer', color: locationId === loc.id ? 'var(--accent-color)' : 'var(--text-primary)', backgroundColor: locationId === loc.id ? 'var(--bg-color)' : 'transparent', borderBottom: '1px solid var(--border-color)', transition: 'background-color 0.2s' }}
                                        onMouseEnter={e => { if (locationId !== loc.id) e.currentTarget.style.backgroundColor = 'var(--bg-color)'; }}
                                        onMouseLeave={e => { if (locationId !== loc.id) e.currentTarget.style.backgroundColor = 'transparent'; }}
                                    >
                                        {loc.label}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid var(--border-color)', marginBottom: '2rem', overflowX: 'auto' }}>
                {TABS.map(tab => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        style={{
                            padding: '1rem 2rem', background: 'none', border: 'none',
                            color: activeTab === tab ? 'var(--accent-color)' : 'var(--text-muted)',
                            borderBottom: activeTab === tab ? '2px solid var(--accent-color)' : '2px solid transparent',
                            fontWeight: activeTab === tab ? 600 : 400, cursor: 'pointer', fontSize: '1rem',
                            transition: 'all 0.2s ease', whiteSpace: 'nowrap',
                        }}
                    >
                        {tab}
                    </button>
                ))}
            </div>

            {/* Content */}
            {loading ? (
                <div style={{ animation: 'fadeIn 0.3s ease-in-out', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                    {activeTab === 'Reviews' && (
                        <>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
                                <SkeletonKpiCard /><SkeletonKpiCard /><SkeletonKpiCard /><SkeletonKpiCard />
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: '1.5rem' }}>
                                <SkeletonChart height={250} /><SkeletonChart height={250} />
                            </div>
                            <SkeletonTable rows={4} />
                        </>
                    )}
                    {activeTab === 'Search Console' && (
                        <>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
                                <SkeletonKpiCard /><SkeletonKpiCard /><SkeletonKpiCard /><SkeletonKpiCard />
                            </div>
                            <SkeletonChart height={280} />
                            <SkeletonTable rows={5} />
                            <SkeletonTable rows={3} />
                        </>
                    )}
                    {activeTab === 'Competitors' && (
                        <>
                            <SkeletonChart height={200} />
                            <SkeletonChart height={350} />
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem' }}>
                                <SkeletonChart height={200} /><SkeletonChart height={200} />
                            </div>
                        </>
                    )}
                </div>
            ) : (
                <div style={{ animation: 'fadeIn 0.3s ease-in-out' }}>
                    {activeTab === 'Reviews' && renderReviewsTab()}
                    {activeTab === 'Search Console' && renderSearchTab()}
                    {activeTab === 'Competitors' && renderCompetitorsTab()}
                </div>
            )}
        </div>
    );
}
