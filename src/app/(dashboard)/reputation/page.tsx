'use client';

import { useState, useEffect } from 'react';
import { SkeletonKpiCard, SkeletonChart, SkeletonTable } from '@/components/Skeleton';
import { format } from 'date-fns';

const TABS = ['Reviews', 'Search Console', 'Competitors'] as const;
type TabType = typeof TABS[number];

// Location constants
const LOCATIONS = [
    { id: 'all', label: 'All Locations' },
    { id: 'atlanta', label: 'Atlanta' },
    { id: 'decatur', label: 'Decatur' },
    { id: 'kennesaw', label: 'Kennesaw' },
];

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

export default function ReputationPage() {
    const [activeTab, setActiveTab] = useState<TabType>('Reviews');
    const [locationId, setLocationId] = useState<string>('all');
    const [reviewFilter, setReviewFilter] = useState<'Relevant' | 'Newest' | 'Lowest Rating' | 'Needs Reply'>('Relevant');

    // Data states
    const [reviewsData, setReviewsData] = useState<any>(null);
    const [searchData, setSearchData] = useState<any>(null);
    const [compData, setCompData] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    const fetchData = async () => {
        setLoading(true);
        try {
            const query = locationId !== 'all' ? `?location=${locationId}` : '';

            const [revRes, searchRes, compRes] = await Promise.all([
                fetch(`/api/reputation/reviews${query}`),
                fetch(`/api/reputation/search?period=30`), // Search console is global typically
                fetch(`/api/reputation/competitors${query}`)
            ]);

            setReviewsData(await revRes.json());
            setSearchData(await searchRes.json());
            setCompData(await compRes.json());
        } catch (e) {
            console.error('Failed to fetch reputation data', e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [locationId]);

    const renderReviewsTab = () => {
        if (!reviewsData) return null;
        const { metrics, reviews } = reviewsData;

        let filteredReviews = [...reviews];
        if (reviewFilter === 'Relevant') {
            filteredReviews.sort((a, b) => {
                const lenA = a.text ? a.text.length : 0;
                const lenB = b.text ? b.text.length : 0;
                // If texts are same length, sort by rating descending, then newest
                if (lenA === lenB) {
                    if (a.rating === b.rating) {
                        return new Date(b.date).getTime() - new Date(a.date).getTime();
                    }
                    return b.rating - a.rating;
                }
                return lenB - lenA; // Longest text first
            });
        } else if (reviewFilter === 'Newest') {
            filteredReviews.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        } else if (reviewFilter === 'Lowest Rating') {
            filteredReviews.sort((a, b) => {
                if (a.rating === b.rating) {
                    return new Date(b.date).getTime() - new Date(a.date).getTime();
                }
                return a.rating - b.rating;
            });
        } else if (reviewFilter === 'Needs Reply') {
            filteredReviews = filteredReviews.filter(r => r.rating <= 3); // Needs Reply (3 stars or under)
            filteredReviews.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        }

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                {/* Aggregate KPI Cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
                    <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
                        <div style={{ position: 'absolute', top: 0, right: 0, padding: '4px 12px', background: 'rgba(255,215,0,0.1)', color: '#FFD700', fontSize: '0.7rem', borderBottomLeftRadius: '8px', fontWeight: 600 }}>LIVE</div>
                        <div style={{ fontSize: '1rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Google Rating</div>
                        <div style={{ fontSize: '2.5rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                            {Math.round(metrics.breakdown.google.rating * 10) / 10} <span style={{ fontSize: '1.5rem', color: '#FFD700' }}>★</span>
                        </div>
                    </div>
                    <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                        <div style={{ fontSize: '1rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Total Google Reviews</div>
                        <div style={{ fontSize: '2.5rem', fontWeight: 600, color: 'var(--text-primary)' }}>{metrics.breakdown.google.count}</div>
                    </div>
                </div>

                {/* Review Feed */}
                <div style={{ backgroundColor: 'var(--card-bg)', padding: '2rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                        <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.4rem' }}>Recent Reviews</h3>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            {['Relevant', 'Newest', 'Lowest Rating', 'Needs Reply'].map(f => (
                                <button
                                    key={f}
                                    onClick={() => setReviewFilter(f as any)}
                                    style={{
                                        padding: '0.5rem 1rem',
                                        backgroundColor: reviewFilter === f ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                                        color: reviewFilter === f ? '#fff' : 'var(--text-muted)',
                                        border: `1px solid ${reviewFilter === f ? 'rgba(255, 255, 255, 0.2)' : 'var(--border-color)'}`,
                                        borderRadius: '20px',
                                        cursor: 'pointer',
                                        fontSize: '0.85rem',
                                        transition: 'all 0.2s',
                                        fontWeight: reviewFilter === f ? 600 : 400
                                    }}
                                >
                                    {f}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                        {filteredReviews.length === 0 ? (
                            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>No reviews match this filter.</div>
                        ) : filteredReviews.map((req: any, i: number) => (
                            <div key={`${req.platform}-${req.id}-${i}`} style={{ backgroundColor: 'var(--bg-color)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
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
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    };

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

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
                    <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                        <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Total Clicks</div>
                        <div style={{ fontSize: '2rem', fontWeight: 600, color: 'var(--text-primary)' }}>{searchData.totals.clicks}</div>
                    </div>
                    <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                        <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Total Impressions</div>
                        <div style={{ fontSize: '2rem', fontWeight: 600, color: 'var(--text-primary)' }}>{searchData.totals.impressions}</div>
                    </div>
                    <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                        <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Average CTR</div>
                        <div style={{ fontSize: '2rem', fontWeight: 600, color: 'var(--text-primary)' }}>{(searchData.totals.ctr * 100).toFixed(2)}%</div>
                    </div>
                    <div style={{ backgroundColor: 'var(--card-bg)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                        <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Average Position</div>
                        <div style={{ fontSize: '2rem', fontWeight: 600, color: 'var(--text-primary)' }}>{searchData.totals.position.toFixed(1)}</div>
                    </div>
                </div>

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
                                {searchData.topQueries.map((q: any) => (
                                    <tr key={q.query} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                        <td style={{ padding: '1rem 0', color: 'var(--text-primary)', fontWeight: 500 }}>{q.query}</td>
                                        <td style={{ padding: '1rem 0', color: 'var(--text-primary)' }}>{q.clicks}</td>
                                        <td style={{ padding: '1rem 0', color: 'var(--text-primary)' }}>{q.impressions}</td>
                                        <td style={{ padding: '1rem 0', color: 'var(--accent-color)' }}>{(q.ctr * 100).toFixed(1)}%</td>
                                        <td style={{ padding: '1rem 0', color: 'var(--text-primary)' }}>{q.position.toFixed(1)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        );
    };

    const renderCompetitorsTab = () => {
        if (!compData) return null;

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h2 style={{ fontSize: '1.5rem', color: 'var(--text-primary)', margin: 0 }}>Competitor Analysis</h2>
                </div>

                {/* Actionable Feedback Section */}
                <div style={{ backgroundColor: 'var(--card-bg)', borderRadius: '12px', border: '1px solid var(--accent-color)', padding: '2rem', position: 'relative', overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', top: 0, left: 0, width: '4px', height: '100%', backgroundColor: 'var(--accent-color)' }}></div>
                    <h3 style={{ marginTop: 0, marginBottom: '0.5rem', color: 'var(--text-primary)', fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span>💡</span> Actionable Feedback
                    </h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>Strategic recommendations based on {compData.competitors[0]?.name || 'your business'}'s AI landscape analysis.</p>

                    <ul style={{ margin: 0, paddingLeft: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        {compData.competitors[0]?.feedback?.map((fb: string, i: number) => (
                            <li key={i} style={{ color: 'var(--text-primary)', lineHeight: 1.5, fontSize: '1rem' }}>
                                {fb}
                            </li>
                        ))}
                    </ul>
                </div>

                {/* Competitive Landscape Grid */}
                <div style={{ backgroundColor: 'var(--card-bg)', borderRadius: '12px', border: '1px solid var(--border-color)', padding: '2rem' }}>
                    <h3 style={{ marginTop: 0, marginBottom: '0.5rem', color: 'var(--text-primary)', fontSize: '1.2rem' }}>Competitor Analysis Grid</h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '2rem' }}>Discover what keywords reveal about you and your competitors via AI analysis.</p>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
                        {compData.competitors.map((c: any) => (
                            <div key={`landscape-${c.id}`} style={{ border: '1px solid var(--border-color)', padding: '1.5rem', borderRadius: '12px', backgroundColor: 'var(--bg-color)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                                    <div style={{ width: '40px', height: '40px', backgroundColor: c.isOurBusiness ? 'var(--accent-color)' : '#475569', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: c.isOurBusiness ? '#000' : '#fff', fontWeight: 600 }}>
                                        {c.name.substring(0, 2).toUpperCase()}
                                    </div>
                                    <div>
                                        <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '1.1rem' }}>
                                            {c.name} {c.isOurBusiness && <span style={{ fontSize: '0.7rem', background: 'rgba(255,215,0,0.1)', color: 'var(--accent-color)', padding: '2px 6px', borderRadius: '4px', marginLeft: '6px' }}>Your Business</span>}
                                        </div>
                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>From {c.reviewCount} reviews</div>
                                    </div>
                                </div>

                                <div style={{ marginBottom: '1.5rem' }}>
                                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>Strengths 💪</div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                        {c.strengths.map((str: string, i: number) => (
                                            <span key={i} style={{ fontSize: '0.8rem', color: '#4ade80', background: 'rgba(74, 222, 128, 0.1)', padding: '4px 10px', borderRadius: '16px', border: '1px solid rgba(74, 222, 128, 0.2)' }}>
                                                ✓ {str}
                                            </span>
                                        ))}
                                    </div>
                                </div>

                                {c.weaknesses && c.weaknesses.length > 0 && (
                                    <div>
                                        <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>Weaknesses 👎</div>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                            {c.weaknesses.map((wk: string, i: number) => (
                                                <span key={i} style={{ fontSize: '0.8rem', color: '#f87171', background: 'rgba(248, 113, 113, 0.1)', padding: '4px 10px', borderRadius: '16px', border: '1px solid rgba(248, 113, 113, 0.2)' }}>
                                                    ✕ {wk}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem' }}>
                <div>
                    <h1 style={{ fontSize: '2rem', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 0.5rem 0' }}>Reputation Management</h1>
                    <p style={{ color: 'var(--text-muted)', margin: 0 }}>Monitor reviews, search visibility, and competitor performance.</p>
                </div>

                {/* Custom Location Picker */}
                <div style={{ position: 'relative' }}>
                    <button
                        onClick={() => {
                            const dropdown = document.getElementById('location-dropdown');
                            if (dropdown) dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
                        }}
                        style={{
                            padding: '0.75rem 1rem',
                            backgroundColor: 'var(--card-bg)',
                            color: 'var(--text-primary)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '8px',
                            fontSize: '1rem',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            minWidth: '160px',
                            justifyContent: 'space-between'
                        }}
                    >
                        {LOCATIONS.find(l => l.id === locationId)?.label || 'All Locations'}
                        <span style={{ fontSize: '0.8rem' }}>▼</span>
                    </button>

                    <div
                        id="location-dropdown"
                        style={{
                            display: 'none',
                            position: 'absolute',
                            top: '100%',
                            right: 0,
                            marginTop: '0.5rem',
                            backgroundColor: 'var(--card-bg)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '8px',
                            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)',
                            zIndex: 50,
                            minWidth: '160px',
                            overflow: 'hidden'
                        }}
                    >
                        {LOCATIONS.map(loc => (
                            <div
                                key={loc.id}
                                onClick={() => {
                                    setLocationId(loc.id);
                                    const dropdown = document.getElementById('location-dropdown');
                                    if (dropdown) dropdown.style.display = 'none';
                                }}
                                style={{
                                    padding: '0.75rem 1rem',
                                    cursor: 'pointer',
                                    color: locationId === loc.id ? 'var(--accent-color)' : 'var(--text-primary)',
                                    backgroundColor: locationId === loc.id ? 'var(--bg-color)' : 'transparent',
                                    borderBottom: '1px solid var(--border-color)',
                                    transition: 'background-color 0.2s'
                                }}
                                onMouseEnter={(e) => { if (locationId !== loc.id) e.currentTarget.style.backgroundColor = 'var(--bg-color)'; }}
                                onMouseLeave={(e) => { if (locationId !== loc.id) e.currentTarget.style.backgroundColor = 'transparent'; }}
                            >
                                {loc.label}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Tabs Navigation */}
            <div style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid var(--border-color)', marginBottom: '2rem' }}>
                {TABS.map(tab => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        style={{
                            padding: '1rem 2rem',
                            background: 'none',
                            border: 'none',
                            color: activeTab === tab ? 'var(--accent-color)' : 'var(--text-muted)',
                            borderBottom: activeTab === tab ? '2px solid var(--accent-color)' : '2px solid transparent',
                            fontWeight: activeTab === tab ? 600 : 400,
                            cursor: 'pointer',
                            fontSize: '1rem',
                            transition: 'all 0.2s ease'
                        }}
                    >
                        {tab}
                    </button>
                ))}
            </div>

            {/* Content Area */}
            {loading ? (
                <div style={{ animation: 'fadeIn 0.3s ease-in-out', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                    {activeTab === 'Reviews' && (
                        <>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1.5rem' }}>
                                <SkeletonKpiCard />
                                <SkeletonKpiCard />
                                <SkeletonKpiCard />
                                <SkeletonKpiCard />
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: '2rem' }}>
                                <SkeletonTable rows={4} />
                                <SkeletonChart height={300} />
                            </div>
                        </>
                    )}
                    {activeTab === 'Search Console' && (
                        <>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1.5rem' }}>
                                <SkeletonKpiCard />
                                <SkeletonKpiCard />
                                <SkeletonKpiCard />
                                <SkeletonKpiCard />
                            </div>
                            <SkeletonChart height={280} />
                            <SkeletonTable rows={5} />
                        </>
                    )}
                    {activeTab === 'Competitors' && (
                        <>
                            <SkeletonChart height={200} />
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '2rem' }}>
                                <SkeletonChart height={150} />
                                <SkeletonChart height={150} />
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
