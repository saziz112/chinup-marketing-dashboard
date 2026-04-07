'use client';

import { useSession } from 'next-auth/react';
import { useState, useEffect, useCallback, useRef } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { formatNumber, formatCurrency } from '@/lib/format';
import { LOCATION_OPTIONS, type LocationFilter } from '@/lib/constants';

type Tab = 'overview' | 'action' | 'campaigns';

interface PipelineResponse {
    configured: boolean;
    locations: {
        location: string;
        locationName: string;
        pipelines: {
            id: string;
            name: string;
            stages: { id: string; name: string; position: number; count: number; value: number }[];
            totalOpen: number;
            totalValue: number;
            wonCount: number;
            lostCount: number;
        }[];
    }[];
    totals: {
        totalOpen: number;
        totalValue: number;
        totalWon: number;
        totalWonValue: number;
        totalLost: number;
        conversionRate: number;
    };
    sourceBreakdown: { source: string; count: number; value: number }[];
    fetchedAt: string;
}

const LIFECYCLE_STAGES = [
    { key: 'untouched', label: 'Untouched', color: '#94A3B8', desc: 'Never contacted' },
    { key: 'attempted', label: 'Attempted', color: '#FBBF24', desc: 'Outbound sent, no reply' },
    { key: 'engaged', label: 'Engaged', color: '#60A5FA', desc: 'Two-way conversation' },
    { key: 'quoted', label: 'Quoted', color: '#A78BFA', desc: 'Discussed pricing/services' },
    { key: 'ghost', label: 'Ghost', color: '#F87171', desc: 'Was engaged, went silent' },
    { key: 'converted', label: 'Converted', color: '#34D399', desc: 'Opportunity won' },
] as const;

const TAB_CONFIG: { id: Tab; label: string; adminOnly?: boolean }[] = [
    { id: 'overview', label: 'Pipeline Summary' },
    { id: 'action', label: 'Leads & Outreach' },
    { id: 'campaigns', label: 'Campaigns', adminOnly: true },
];

const CAMPAIGN_SEGMENTS = [
    { id: 'untouched', label: 'Never Contacted', desc: 'Leads with zero outreach attempts', source: 'conversations' },
    { id: 'attempted-no-reply', label: 'Attempted, No Reply', desc: 'Outbound sent 7+ days ago, no inbound', source: 'conversations' },
    { id: 're-engage-ghost', label: 'Re-engage Ghosts', desc: 'Was engaged, silent 14-60 days', source: 'conversations' },
    { id: 'quoted-followup', label: 'Quoted, Not Booked', desc: 'Discussed pricing 7+ days ago', source: 'conversations' },
    { id: 'ghost', label: 'Ghosted (Legacy)', desc: 'Ghost lifecycle, 14+ days silent', source: 'conversations' },
    { id: 'cancelled', label: 'Cancelled Appointments', desc: 'MindBody cancellations', source: 'mindbody' },
    { id: 'consult-only', label: 'Consulted, Not Treated', desc: 'Had consult, never booked', source: 'mindbody' },
    { id: 'lapsed-vip', label: 'Lapsed VIPs ($500+)', desc: '120-365 days since last visit', source: 'mindbody' },
    { id: 'lapsed-long', label: 'Long-Lapsed', desc: '180+ days since last visit', source: 'mindbody' },
    { id: 'lapsed-winback', label: 'Win-Back VIPs', desc: '$500+, 365+ days', source: 'mindbody' },
    { id: 'lapsed-treatment', label: 'Treatment-Specific', desc: 'By treatment type, 90+ days', source: 'mindbody' },
    { id: 'never-booked', label: 'Never Booked', desc: 'Inquired but never purchased', source: 'ghl' },
];

export default function LeadsPipelinePage() {
    const { data: session } = useSession();
    const user = session?.user as Record<string, unknown> | undefined;
    const isAdmin = user?.isAdmin === true;

    const [tab, setTab] = useState<Tab>('overview');
    const [location, setLocation] = useState<LocationFilter>('all');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Pipeline data (overview tab)
    const [pipelineData, setPipelineData] = useState<PipelineResponse | null>(null);

    // Engagement/conversations data (action tab)
    const [engagementData, setEngagementData] = useState<any>(null);
    const [engagementLoading, setEngagementLoading] = useState(false);
    const engagementFetchedRef = useRef<string | null>(null);

    // Pipeline reorganization state
    const [reorgData, setReorgData] = useState<any>(null);
    const [reorgLoading, setReorgLoading] = useState(false);
    const [reorgOpen, setReorgOpen] = useState(false);
    const [reorgSelected, setReorgSelected] = useState<Set<string>>(new Set());
    const [reorgApplying, setReorgApplying] = useState(false);
    const [reorgResults, setReorgResults] = useState<any>(null);

    // Transcript viewer state
    const [transcriptOpen, setTranscriptOpen] = useState(false);
    const [transcriptData, setTranscriptData] = useState<any>(null);
    const [transcriptLoading, setTranscriptLoading] = useState(false);
    const [transcriptContactName, setTranscriptContactName] = useState('');

    // SMS/Email Re-activation state
    const [smsOpen, setSmsOpen] = useState(false);
    const [smsStep, setSmsStep] = useState<1 | 2 | 3>(1);
    const [smsSegment, setSmsSegment] = useState<string>('untouched');
    const [smsData, setSmsData] = useState<any>(null);
    const [smsLoading, setSmsLoading] = useState(false);
    const [smsError, setSmsError] = useState<string | null>(null);
    const [smsMessage, setSmsMessage] = useState('');
    const [smsSelected, setSmsSelected] = useState<Set<string>>(new Set());
    const [smsSending, setSmsSending] = useState(false);
    const [smsResults, setSmsResults] = useState<any>(null);
    const [smsChannel, setSmsChannel] = useState<'sms' | 'email'>('sms');
    const [smsSubject, setSmsSubject] = useState('');
    const [smsLocationFilter, setSmsLocationFilter] = useState<string>('all');
    const [smsTestSending, setSmsTestSending] = useState(false);
    const [smsTestResult, setSmsTestResult] = useState<{ success: boolean; message: string } | null>(null);
    const [campaignHistory, setCampaignHistory] = useState<Record<string, { runAt: string; totalSent: number; channel: string }>>({});
    const [treatmentFilter, setTreatmentFilter] = useState('');
    const [treatments, setTreatments] = useState<string[]>([]);

    // --- Fetch Functions ---

    const fetchPipeline = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const params = location !== 'all' ? `?location=${location}` : '';
            const res = await fetch(`/api/attribution/ghl-pipeline${params}`);
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to fetch pipeline data');
            }
            setPipelineData(await res.json());
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    }, [location]);

    const fetchEngagement = useCallback(async () => {
        setEngagementLoading(true);
        try {
            const params = new URLSearchParams({ mode: 'full' });
            if (location !== 'all') params.set('location', location);
            const res = await fetch(`/api/attribution/ghl-conversations?${params}`);
            if (res.ok) {
                setEngagementData(await res.json());
            }
        } catch {
            // Supplementary
        } finally {
            setEngagementLoading(false);
        }
    }, [location]);

    const fetchTranscript = useCallback(async (messageId: string, locationKey: string, contactName: string) => {
        setTranscriptOpen(true);
        setTranscriptLoading(true);
        setTranscriptContactName(contactName);
        setTranscriptData(null);
        try {
            const res = await fetch(`/api/attribution/ghl-transcript?messageId=${messageId}&location=${locationKey}`);
            if (res.ok) setTranscriptData(await res.json());
        } catch { /* error */ } finally {
            setTranscriptLoading(false);
        }
    }, []);

    const fetchReorgRecommendations = useCallback(async () => {
        setReorgLoading(true);
        setReorgResults(null);
        try {
            const params = location !== 'all' ? `?location=${location}` : '';
            const res = await fetch(`/api/attribution/ghl-pipeline-reorg${params}`);
            if (res.ok) {
                const data = await res.json();
                setReorgData(data);
                const selected = new Set<string>();
                (data.recommendations || []).forEach((r: any) => {
                    if (r.confidence === 'high') selected.add(r.opportunityId);
                });
                setReorgSelected(selected);
            }
        } catch { /* supplementary */ } finally {
            setReorgLoading(false);
        }
    }, [location]);

    const fetchSmsContacts = useCallback(async (segment: string) => {
        setSmsLoading(true);
        setSmsError(null);
        setSmsData(null);
        setSmsLocationFilter('all');
        setSmsTestResult(null);
        try {
            const params = new URLSearchParams({ segment });
            if (segment === 'lapsed-treatment' && treatmentFilter) {
                params.set('treatment', treatmentFilter);
            }
            const res = await fetch(`/api/attribution/ghl-reactivation?${params}`);
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || `Failed to load contacts (${res.status})`);
            }
            const data = await res.json();
            setSmsData(data);
            setSmsSelected(new Set((data.contacts || []).map((c: any) => c.contactId)));
            if (smsChannel === 'email') {
                const etmpl = data.emailTemplates?.[segment];
                if (etmpl?.template) { setSmsMessage(etmpl.template); setSmsSubject(etmpl.subject || ''); }
            } else {
                const tmpl = data.templates?.[segment];
                if (tmpl?.template) setSmsMessage(tmpl.template);
            }
            if (data.lastCampaign) {
                setCampaignHistory(prev => ({ ...prev, [segment]: data.lastCampaign }));
            }
        } catch (err: unknown) {
            setSmsError(err instanceof Error ? err.message : 'Failed to load contacts');
        } finally {
            setSmsLoading(false);
        }
    }, [smsChannel, treatmentFilter]);

    const sendSmsCampaign = useCallback(async () => {
        if (!smsData?.contacts || smsSelected.size === 0 || !smsMessage) return;
        setSmsSending(true);
        setSmsError(null);
        try {
            const visibleContacts = smsLocationFilter === 'all'
                ? smsData.contacts
                : smsData.contacts.filter((c: any) => c.locationKey === smsLocationFilter);
            const selectedContacts = visibleContacts.filter((c: any) => smsSelected.has(c.contactId));
            if (selectedContacts.length === 0) {
                setSmsError('No contacts matched after filtering.');
                setSmsSending(false);
                return;
            }
            const contactsByLocation = new Map<string, any[]>();
            for (const c of selectedContacts) {
                const locKey = c.locationKey || 'decatur';
                const list = contactsByLocation.get(locKey) || [];
                list.push(c);
                contactsByLocation.set(locKey, list);
            }
            const allResults: any[] = [];
            const allErrors: string[] = [];
            for (const [locKey, contacts] of contactsByLocation) {
                try {
                    const res = await fetch('/api/attribution/ghl-reactivation', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contactIds: contacts.map((c: any) => c.contactId),
                            contacts,
                            message: smsMessage,
                            locationKey: locKey,
                            channel: smsChannel,
                            segment: smsSegment,
                            subject: smsChannel === 'email' ? smsSubject : undefined,
                        }),
                    });
                    if (res.ok) allResults.push(await res.json());
                    else {
                        const errData = await res.json().catch(() => ({}));
                        allErrors.push(errData.error || `API error ${res.status} for ${locKey}`);
                    }
                } catch (fetchErr: unknown) {
                    allErrors.push(`${locKey}: ${fetchErr instanceof Error ? fetchErr.message : 'Network error'}`);
                }
            }
            setSmsResults({
                sent: allResults.reduce((s, r) => s + (r.sent || 0), 0),
                failed: allResults.reduce((s, r) => s + (r.failed || 0), 0),
                skipped: allResults.reduce((s, r) => s + (r.skipped || 0), 0),
                channel: smsChannel,
                emailCapped: allResults.some(r => r.emailCapped),
                errors: allErrors.length > 0 ? allErrors : undefined,
            });
            setSmsStep(3);
        } catch (err: unknown) {
            setSmsError(`Send failed: ${err instanceof Error ? err.message : 'Unknown'}`);
        } finally {
            setSmsSending(false);
        }
    }, [smsData, smsSelected, smsMessage, smsChannel, smsSegment, smsSubject, smsLocationFilter]);

    const sendTestMessage = useCallback(async () => {
        if (!smsMessage) return;
        setSmsTestSending(true);
        setSmsTestResult(null);
        try {
            const locKey = smsLocationFilter !== 'all' ? smsLocationFilter : (smsData?.contacts?.[0]?.locationKey || 'decatur');
            const res = await fetch('/api/attribution/ghl-reactivation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    testMode: true,
                    channel: smsChannel,
                    message: smsMessage,
                    locationKey: locKey,
                    testPhone: '4046685785',
                    testEmail: 'saziz112@gmail.com',
                    subject: smsChannel === 'email' ? smsSubject : undefined,
                }),
            });
            const data = await res.json();
            setSmsTestResult(data.success
                ? { success: true, message: `Test ${smsChannel} sent to ${data.recipient}` }
                : { success: false, message: data.error || 'Test failed' }
            );
        } catch (err: unknown) {
            setSmsTestResult({ success: false, message: err instanceof Error ? err.message : 'Test failed' });
        } finally {
            setSmsTestSending(false);
        }
    }, [smsMessage, smsChannel, smsSubject, smsLocationFilter, smsData]);

    const applyReorgMoves = useCallback(async () => {
        if (!reorgData?.recommendations || reorgSelected.size === 0) return;
        setReorgApplying(true);
        try {
            const moves = reorgData.recommendations
                .filter((r: any) => reorgSelected.has(r.opportunityId))
                .map((r: any) => ({
                    opportunityId: r.opportunityId,
                    newStageId: r.recommendedStageId,
                    pipelineId: r.pipelineId,
                    locationKey: r.locationKey,
                }));
            const res = await fetch('/api/attribution/ghl-pipeline-reorg', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ moves }),
            });
            if (res.ok) setReorgResults(await res.json());
        } catch { /* error */ } finally {
            setReorgApplying(false);
        }
    }, [reorgData, reorgSelected]);

    // --- Effects ---

    useEffect(() => {
        if (session) fetchPipeline();
    }, [session, fetchPipeline]);

    useEffect(() => {
        if (session && tab === 'action' && engagementFetchedRef.current !== location) {
            engagementFetchedRef.current = location;
            fetchEngagement();
        }
    }, [session, tab, fetchEngagement, location]);

    // --- Render ---

    return (
        <>
            <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
                <div>
                    <h1>Leads & Pipeline</h1>
                    <p className="subtitle">Conversation-first lead intelligence across all locations</p>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {LOCATION_OPTIONS.map(opt => (
                        <button
                            key={opt.id}
                            className={`period-btn ${location === opt.id ? 'active' : ''}`}
                            onClick={() => setLocation(opt.id)}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: '4px', marginBottom: '24px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0' }}>
                {TAB_CONFIG.filter(t => !t.adminOnly || isAdmin).map(t => (
                    <button
                        key={t.id}
                        onClick={() => setTab(t.id)}
                        style={{
                            padding: '10px 20px',
                            background: 'transparent',
                            border: 'none',
                            borderBottom: tab === t.id ? '2px solid var(--accent-primary)' : '2px solid transparent',
                            color: tab === t.id ? 'var(--text-primary)' : 'var(--text-muted)',
                            fontWeight: tab === t.id ? 600 : 400,
                            fontSize: '0.875rem',
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                        }}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {error && (
                <div className="section-card" style={{ borderColor: '#F87171', background: 'rgba(248,113,113,0.1)' }}>
                    <p style={{ color: '#F87171', margin: 0 }}>Error: {error}</p>
                </div>
            )}

            {/* ═══════════════════════════════════════════════════ */}
            {/* Tab: Pipeline Summary (compact overview) */}
            {/* ═══════════════════════════════════════════════════ */}
            {tab === 'overview' && (
                <>
                    {loading ? (
                        <div className="section-card">
                            <div className="empty-state">
                                <h3>Loading pipeline data...</h3>
                                <p>Fetching opportunities from GoHighLevel</p>
                            </div>
                        </div>
                    ) : pipelineData ? (
                        <>
                            {/* Compact KPI cards */}
                            <div className="metrics-grid" style={{ gridTemplateColumns: `repeat(${isAdmin ? 5 : 4}, 1fr)` }}>
                                <div className="metric-card">
                                    <div className="label">Open</div>
                                    <div className="value">{formatNumber(pipelineData.totals.totalOpen)}</div>
                                    <div className="change">Active leads</div>
                                </div>
                                {isAdmin && (
                                    <div className="metric-card">
                                        <div className="label">Pipeline Value</div>
                                        <div className="value">{formatCurrency(pipelineData.totals.totalValue)}</div>
                                        <div className="change">Total open value</div>
                                    </div>
                                )}
                                <div className="metric-card">
                                    <div className="label">Won</div>
                                    <div className="value" style={{ color: '#34D399' }}>{formatNumber(pipelineData.totals.totalWon)}</div>
                                    <div className="change positive">Converted</div>
                                </div>
                                <div className="metric-card">
                                    <div className="label">Lost</div>
                                    <div className="value" style={{ color: '#F87171' }}>{formatNumber(pipelineData.totals.totalLost)}</div>
                                    <div className="change">Abandoned</div>
                                </div>
                                <div className="metric-card">
                                    <div className="label">Conversion</div>
                                    <div className="value">{pipelineData.totals.conversionRate}%</div>
                                    <div className="change">Won / (Won + Lost)</div>
                                </div>
                            </div>

                            {/* Per-Location Summary + Lifecycle/Speed side-by-side */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                                {/* Per-Location Breakdown */}
                                <div className="section-card">
                                    <h3 style={{ marginBottom: '16px' }}>By Location</h3>
                                    <div className="data-table-wrapper"><table className="data-table">
                                        <thead>
                                            <tr>
                                                <th>Location</th>
                                                <th style={{ textAlign: 'right' }}>Open</th>
                                                <th style={{ textAlign: 'right' }}>Won</th>
                                                <th style={{ textAlign: 'right' }}>Lost</th>
                                                <th style={{ textAlign: 'right' }}>Conv %</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {pipelineData.locations.map(loc => {
                                                const open = loc.pipelines.reduce((s, p) => s + p.totalOpen, 0);
                                                const won = loc.pipelines.reduce((s, p) => s + p.wonCount, 0);
                                                const lost = loc.pipelines.reduce((s, p) => s + p.lostCount, 0);
                                                const rate = (won + lost) > 0 ? Math.round((won / (won + lost)) * 100) : 0;
                                                return (
                                                    <tr key={loc.location}>
                                                        <td style={{ fontWeight: 600 }}>{loc.locationName}</td>
                                                        <td style={{ textAlign: 'right' }}>{formatNumber(open)}</td>
                                                        <td style={{ textAlign: 'right', color: '#34D399' }}>{formatNumber(won)}</td>
                                                        <td style={{ textAlign: 'right', color: '#F87171' }}>{formatNumber(lost)}</td>
                                                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{rate}%</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table></div>
                                </div>

                                {/* Lifecycle Breakdown (from conversations API if available) */}
                                {engagementData?.lifecycleCounts ? (
                                    <div className="section-card">
                                        <h3 style={{ marginBottom: '16px' }}>Lifecycle Breakdown</h3>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            {LIFECYCLE_STAGES.map(stage => {
                                                const count = engagementData.lifecycleCounts[stage.key] || 0;
                                                const total = engagementData.summary?.totalAnalyzed || 1;
                                                const pct = Math.round((count / total) * 100);
                                                return (
                                                    <div key={stage.key} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                        <span style={{ width: '100px', fontSize: '0.8125rem', color: stage.color, fontWeight: 600, flexShrink: 0 }}>
                                                            {stage.label}
                                                        </span>
                                                        <div style={{ flex: 1, height: '8px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                                                            <div style={{ width: `${pct}%`, height: '100%', background: stage.color, borderRadius: '4px' }} />
                                                        </div>
                                                        <span style={{ width: '80px', textAlign: 'right', fontSize: '0.8125rem', fontWeight: 600 }}>
                                                            {count} ({pct}%)
                                                        </span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '12px', marginBottom: 0 }}>
                                            Based on conversation analysis of {engagementData.summary?.totalAnalyzed || 0} contacts
                                        </p>
                                    </div>
                                ) : (
                                    <div className="section-card">
                                        <h3 style={{ marginBottom: '16px' }}>Lifecycle Breakdown</h3>
                                        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                                            Switch to the &quot;Leads &amp; Outreach&quot; tab to load conversation data, then come back for the lifecycle view.
                                        </p>
                                    </div>
                                )}
                            </div>

                            {/* Speed-to-Lead (if available) */}
                            {engagementData?.speedToLead && (
                                <div className="section-card" style={{ marginTop: '24px' }}>
                                    <h3 style={{ marginBottom: '16px' }}>Speed-to-Lead</h3>
                                    <div style={{ marginBottom: '16px', padding: '12px', background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.2)', borderRadius: '8px', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                                        Industry benchmark: Leads contacted within 5 minutes have a 21x higher conversion rate.
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                                        {(['decatur', 'smyrna', 'kennesaw'] as const).map(loc => {
                                            const avg = engagementData.speedToLead.avgMinutes?.[loc];
                                            if (avg === null || avg === undefined) return null;
                                            const label = loc === 'decatur' ? 'Decatur' : loc === 'smyrna' ? 'Smyrna/Vinings' : 'Kennesaw';
                                            const formatted = avg >= 60 ? `${(avg / 60).toFixed(1)} hr` : `${avg} min`;
                                            const color = avg <= 5 ? '#34D399' : avg <= 30 ? '#FBBF24' : '#F87171';
                                            return (
                                                <div key={loc} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }}>
                                                    <span style={{ fontSize: '0.875rem' }}>{label}</span>
                                                    <span style={{ fontWeight: 700, color, fontSize: '1.125rem' }}>{formatted}</span>
                                                </div>
                                            );
                                        })}
                                        {engagementData.speedToLead.neverResponded > 0 && (
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: '8px' }}>
                                                <span style={{ fontSize: '0.875rem', color: '#F87171' }}>Never Responded</span>
                                                <span style={{ fontWeight: 700, color: '#F87171', fontSize: '1.125rem' }}>{engagementData.speedToLead.neverResponded}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="section-card">
                            <div className="empty-state">
                                <h3>No pipeline data</h3>
                                <p>GoHighLevel may not be configured.</p>
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* ═══════════════════════════════════════════════════ */}
            {/* Tab: Leads & Outreach (the daily driver) */}
            {/* ═══════════════════════════════════════════════════ */}
            {tab === 'action' && (
                <>
                    {engagementLoading ? (
                        <div className="section-card">
                            <div className="empty-state">
                                <h3>Analyzing conversations...</h3>
                                <p>Fetching engagement data from GHL Conversations API. This may take 30-60 seconds on first load.</p>
                            </div>
                        </div>
                    ) : engagementData ? (
                        <>
                            {/* Alert Cards */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginBottom: '24px' }}>
                                {(engagementData.lifecycleCounts?.untouched || 0) > 0 && (
                                    <div style={{ padding: '16px', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: '12px' }}>
                                        <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#F87171' }}>
                                            {engagementData.lifecycleCounts.untouched}
                                        </div>
                                        <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#F87171', marginBottom: '4px' }}>
                                            Never Contacted
                                        </div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                            Leads with zero outreach — call them now
                                        </div>
                                    </div>
                                )}
                                {(engagementData.summary?.unrepliedInbound || 0) > 0 && (
                                    <div style={{ padding: '16px', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: '12px' }}>
                                        <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#FBBF24' }}>
                                            {engagementData.summary.unrepliedInbound}
                                        </div>
                                        <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#FBBF24', marginBottom: '4px' }}>
                                            Unreplied Inbound
                                        </div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                            They reached out to us — respond ASAP
                                        </div>
                                    </div>
                                )}
                                {(engagementData.lifecycleCounts?.ghost || 0) > 0 && (
                                    <div style={{ padding: '16px', background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.3)', borderRadius: '12px' }}>
                                        <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#A78BFA' }}>
                                            {engagementData.lifecycleCounts.ghost}
                                        </div>
                                        <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#A78BFA', marginBottom: '4px' }}>
                                            Ghosts
                                        </div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                            Were engaged, went silent 14+ days
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Call List Table */}
                            {engagementData.engagementGaps?.length > 0 && (
                                <div className="section-card">
                                    <div className="chart-header" style={{ marginBottom: '16px' }}>
                                        <h3>Who to Call Next</h3>
                                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                            <span className="badge warning">{engagementData.engagementGaps.length} leads</span>
                                            {isAdmin && (
                                                <button
                                                    className="period-btn"
                                                    onClick={() => { setReorgOpen(true); fetchReorgRecommendations(); }}
                                                    style={{ fontSize: '0.75rem', padding: '4px 12px' }}
                                                >
                                                    Reorganize Pipeline
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    <div className="data-table-wrapper"><table className="data-table">
                                        <thead>
                                            <tr>
                                                <th>Name</th>
                                                <th>Location</th>
                                                <th>Lifecycle</th>
                                                <th style={{ textAlign: 'center' }}>Priority</th>
                                                {isAdmin && <th style={{ textAlign: 'right' }}>Value</th>}
                                                <th style={{ textAlign: 'right' }}>Last Contact</th>
                                                <th style={{ textAlign: 'right' }}>Gap</th>
                                                <th>Action</th>
                                                <th style={{ textAlign: 'center' }}></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {engagementData.engagementGaps.map((gap: any, idx: number) => {
                                                const stageColor = LIFECYCLE_STAGES.find(s => s.key === gap.engagement?.lifecycleStage)?.color || '#94A3B8';
                                                const stageLabel = LIFECYCLE_STAGES.find(s => s.key === gap.engagement?.lifecycleStage)?.label || gap.engagement?.lifecycleStage;
                                                const priority = gap.callPriority ?? gap.achievabilityScore ?? 0;
                                                return (
                                                    <tr key={idx}>
                                                        <td style={{ fontWeight: 600 }}>{gap.opportunity?.contactName || 'Unknown'}</td>
                                                        <td style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>{gap.locationName}</td>
                                                        <td>
                                                            <span style={{
                                                                display: 'inline-block', padding: '2px 8px', borderRadius: '12px',
                                                                fontSize: '0.6875rem', fontWeight: 700,
                                                                background: `${stageColor}20`, color: stageColor,
                                                            }}>
                                                                {stageLabel}
                                                            </span>
                                                        </td>
                                                        <td style={{ textAlign: 'center' }}>
                                                            <span style={{
                                                                display: 'inline-block', padding: '2px 8px', borderRadius: '12px',
                                                                fontSize: '0.75rem', fontWeight: 700,
                                                                background: priority >= 60 ? 'rgba(52,211,153,0.15)' :
                                                                    priority >= 30 ? 'rgba(251,191,36,0.15)' : 'rgba(248,113,113,0.15)',
                                                                color: priority >= 60 ? '#34D399' :
                                                                    priority >= 30 ? '#FBBF24' : '#F87171',
                                                            }}>
                                                                {priority}
                                                            </span>
                                                        </td>
                                                        {isAdmin && (
                                                            <td style={{ textAlign: 'right', fontWeight: 600 }}>
                                                                {gap.monetaryValue > 0 ? formatCurrency(gap.monetaryValue) : '—'}
                                                            </td>
                                                        )}
                                                        <td style={{ textAlign: 'right', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                                                            {gap.engagement?.lastOutboundDate
                                                                ? new Date(gap.engagement.lastOutboundDate).toLocaleDateString()
                                                                : 'Never'}
                                                        </td>
                                                        <td style={{
                                                            textAlign: 'right', fontWeight: 600,
                                                            color: gap.daysSinceOutreach > 30 ? '#F87171' : gap.daysSinceOutreach > 14 ? '#FB923C' : '#FBBF24',
                                                        }}>
                                                            {gap.daysSinceOutreach}d
                                                        </td>
                                                        <td style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', maxWidth: '250px' }}>
                                                            {gap.suggestedAction}
                                                        </td>
                                                        <td style={{ textAlign: 'center' }}>
                                                            {gap.engagement?.phone && (
                                                                <button
                                                                    onClick={() => navigator.clipboard.writeText(gap.engagement.phone)}
                                                                    title="Copy phone number"
                                                                    style={{
                                                                        background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-subtle)',
                                                                        borderRadius: '6px', padding: '4px 8px', cursor: 'pointer',
                                                                        fontSize: '0.6875rem', color: 'var(--text-muted)',
                                                                    }}
                                                                >
                                                                    Copy #
                                                                </button>
                                                            )}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table></div>

                                    {/* Timestamp fallback note */}
                                    {(engagementData.timestampFallbackContacts?.length || 0) > 0 && (
                                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '12px', marginBottom: 0 }}>
                                            + {engagementData.timestampFallbackContacts.length} additional contacts beyond conversation analysis limit (timestamp-only data)
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* Stall Analytics */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginTop: '24px' }}>
                                {/* Ghost Analytics */}
                                {engagementData.ghostAnalytics && (
                                    <div className="section-card">
                                        <h3 style={{ marginBottom: '16px' }}>Why Leads Ghost</h3>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                                            <div style={{ padding: '12px', background: 'rgba(248,113,113,0.06)', borderRadius: '8px', textAlign: 'center' }}>
                                                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#F87171' }}>
                                                    {engagementData.ghostAnalytics.avgMessagesBeforeGhosting || 0}
                                                </div>
                                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Avg messages before ghosting</div>
                                            </div>
                                            <div style={{ padding: '12px', background: 'rgba(248,113,113,0.06)', borderRadius: '8px', textAlign: 'center' }}>
                                                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#F87171' }}>
                                                    {engagementData.ghostAnalytics.avgDaysToGhost || 0}d
                                                </div>
                                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Avg days to ghost</div>
                                            </div>
                                        </div>
                                        {engagementData.ghostAnalytics.ghostRateBySource?.length > 0 && (
                                            <>
                                                <h4 style={{ fontSize: '0.8125rem', fontWeight: 600, marginBottom: '8px', color: 'var(--text-secondary)' }}>
                                                    Ghost Rate by Source
                                                </h4>
                                                {engagementData.ghostAnalytics.ghostRateBySource.slice(0, 5).map((s: any) => (
                                                    <div key={s.source} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                                                        <span style={{ fontSize: '0.8125rem' }}>{s.source}</span>
                                                        <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: s.ghostRate > 40 ? '#F87171' : s.ghostRate > 20 ? '#FBBF24' : '#34D399' }}>
                                                            {s.ghostRate}% ({s.total} leads)
                                                        </span>
                                                    </div>
                                                ))}
                                            </>
                                        )}
                                    </div>
                                )}

                                {/* Ghost Rate by Location + Lifecycle Funnel */}
                                <div className="section-card">
                                    <h3 style={{ marginBottom: '16px' }}>Lifecycle Funnel</h3>
                                    {engagementData.lifecycleCounts && (() => {
                                        const lc = engagementData.lifecycleCounts;
                                        const funnelStages = [
                                            { key: 'untouched', label: 'Untouched', count: lc.untouched || 0, color: '#94A3B8' },
                                            { key: 'attempted', label: 'Attempted', count: lc.attempted || 0, color: '#FBBF24' },
                                            { key: 'engaged', label: 'Engaged', count: lc.engaged || 0, color: '#60A5FA' },
                                            { key: 'quoted', label: 'Quoted', count: lc.quoted || 0, color: '#A78BFA' },
                                            { key: 'converted', label: 'Converted', count: lc.converted || 0, color: '#34D399' },
                                        ];
                                        return (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                {funnelStages.map((stage, idx) => {
                                                    const prev = idx > 0 ? funnelStages[idx - 1].count : stage.count;
                                                    const dropOff = idx > 0 && prev > 0 ? Math.round(((prev - stage.count) / prev) * 100) : 0;
                                                    return (
                                                        <div key={stage.key}>
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: `${stage.color}10`, borderRadius: '6px', borderLeft: `3px solid ${stage.color}` }}>
                                                                <span style={{ fontSize: '0.8125rem', fontWeight: 600 }}>{stage.label}</span>
                                                                <span style={{ fontWeight: 700, color: stage.color }}>{stage.count}</span>
                                                            </div>
                                                            {idx > 0 && dropOff > 0 && (
                                                                <div style={{ textAlign: 'center', fontSize: '0.6875rem', color: dropOff > 50 ? '#F87171' : '#FB923C', padding: '2px 0' }}>
                                                                    -{dropOff}% drop-off
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                                {/* Ghost branch */}
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'rgba(248,113,113,0.06)', borderRadius: '6px', borderLeft: '3px solid #F87171' }}>
                                                    <span style={{ fontSize: '0.8125rem', fontWeight: 600 }}>Ghost (dropped out)</span>
                                                    <span style={{ fontWeight: 700, color: '#F87171' }}>{lc.ghost || 0}</span>
                                                </div>
                                            </div>
                                        );
                                    })()}

                                    {/* Ghost rate by location */}
                                    {engagementData.ghostAnalytics?.ghostRateByLocation?.length > 0 && (
                                        <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-subtle)' }}>
                                            <h4 style={{ fontSize: '0.8125rem', fontWeight: 600, marginBottom: '8px', color: 'var(--text-secondary)' }}>
                                                Ghost Rate by Location
                                            </h4>
                                            {engagementData.ghostAnalytics.ghostRateByLocation.map((l: any) => {
                                                const locName = l.location === 'decatur' ? 'Decatur' : l.location === 'smyrna' ? 'Smyrna/Vinings' : 'Kennesaw';
                                                return (
                                                    <div key={l.location} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
                                                        <span style={{ fontSize: '0.8125rem' }}>{locName}</span>
                                                        <span style={{ fontWeight: 600, fontSize: '0.8125rem', color: l.ghostRate > 30 ? '#F87171' : '#FBBF24' }}>
                                                            {l.ghostRate}%
                                                        </span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Lost Revenue Candidates */}
                            {isAdmin && engagementData.lostRevenueCandidates?.length > 0 && (
                                <div className="section-card" style={{ marginTop: '24px' }}>
                                    <div className="chart-header" style={{ marginBottom: '16px' }}>
                                        <h3>Lost Revenue Candidates</h3>
                                        <span style={{ fontWeight: 700, color: '#F87171' }}>
                                            {formatCurrency(engagementData.summary?.lostRevenuePotential || 0)} at risk
                                        </span>
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '12px' }}>
                                        {engagementData.lostRevenueCandidates.slice(0, 12).map((c: any, idx: number) => (
                                            <div key={idx} style={{
                                                padding: '12px', background: 'rgba(248,113,113,0.04)',
                                                border: '1px solid rgba(248,113,113,0.15)', borderRadius: '8px',
                                            }}>
                                                <div style={{ fontWeight: 600, marginBottom: '4px' }}>
                                                    {c.opportunity?.contactName || c.engagement?.contactName || 'Unknown'}
                                                </div>
                                                <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
                                                    {c.locationName} | {c.stageName}
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem' }}>
                                                    <span style={{ color: '#F87171', fontWeight: 600 }}>{formatCurrency(c.monetaryValue)}</span>
                                                    <span style={{ color: 'var(--text-muted)' }}>{c.daysSilent}d silent | {c.conversationCount} convos</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Refresh button */}
                            <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end' }}>
                                <button
                                    className="period-btn"
                                    onClick={() => { engagementFetchedRef.current = null; fetchEngagement(); }}
                                    disabled={engagementLoading}
                                    style={{ fontSize: '0.8125rem' }}
                                >
                                    {engagementLoading ? 'Refreshing...' : 'Refresh Data'}
                                </button>
                            </div>
                        </>
                    ) : (
                        <div className="section-card">
                            <div className="empty-state">
                                <h3>No engagement data</h3>
                                <p>GHL conversations API may not be configured, or data is loading.</p>
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* ═══════════════════════════════════════════════════ */}
            {/* Tab: Campaigns (admin-only) */}
            {/* ═══════════════════════════════════════════════════ */}
            {tab === 'campaigns' && isAdmin && (
                <div className="section-card">
                    <h3 style={{ marginBottom: '8px' }}>SMS & Email Campaigns</h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '24px' }}>
                        Target leads by conversation lifecycle stage or MindBody patient history. All campaigns apply 30-day cooldowns and DND filtering.
                    </p>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
                        {CAMPAIGN_SEGMENTS.map(seg => {
                            const lastRun = campaignHistory[seg.id];
                            return (
                                <div
                                    key={seg.id}
                                    onClick={() => {
                                        setSmsSegment(seg.id);
                                        setSmsStep(1);
                                        setSmsResults(null);
                                        setSmsError(null);
                                        setSmsOpen(true);
                                        fetchSmsContacts(seg.id);
                                    }}
                                    style={{
                                        padding: '16px', borderRadius: '10px', cursor: 'pointer',
                                        border: '1px solid var(--border-subtle)',
                                        background: seg.source === 'conversations' ? 'rgba(96,165,250,0.04)' : 'rgba(167,139,250,0.04)',
                                        transition: 'border-color 0.2s',
                                    }}
                                    onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent-primary)')}
                                    onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-subtle)')}
                                >
                                    <div style={{ fontWeight: 600, marginBottom: '4px' }}>{seg.label}</div>
                                    <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '8px' }}>{seg.desc}</div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{
                                            fontSize: '0.6875rem', padding: '2px 8px', borderRadius: '4px',
                                            background: seg.source === 'conversations' ? 'rgba(96,165,250,0.15)' : 'rgba(167,139,250,0.15)',
                                            color: seg.source === 'conversations' ? '#60A5FA' : '#A78BFA',
                                        }}>
                                            {seg.source}
                                        </span>
                                        {lastRun && (
                                            <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                                                Last: {new Date(lastRun.runAt).toLocaleDateString()} ({lastRun.totalSent} sent)
                                            </span>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ═══════════════════════════════════════════════════ */}
            {/* Modal: Pipeline Reorganization */}
            {/* ═══════════════════════════════════════════════════ */}
            {reorgOpen && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '24px' }}
                    onClick={(e) => { if (e.target === e.currentTarget) setReorgOpen(false); }}>
                    <div style={{ background: '#1a2332', borderRadius: '16px', border: '1px solid var(--border-subtle)', maxWidth: '800px', width: '100%', maxHeight: '80vh', overflow: 'auto', padding: '32px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                            <h2 style={{ margin: 0 }}>Pipeline Reorganization</h2>
                            <button onClick={() => setReorgOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.25rem' }}>x</button>
                        </div>
                        {reorgLoading ? (
                            <p style={{ color: 'var(--text-muted)' }}>Analyzing conversations to generate stage recommendations...</p>
                        ) : reorgResults ? (
                            <div>
                                <p style={{ color: '#34D399', fontWeight: 600 }}>
                                    {reorgResults.moved || 0} leads moved, {reorgResults.failed || 0} failed
                                </p>
                                <button className="period-btn active" onClick={() => setReorgOpen(false)} style={{ marginTop: '16px' }}>Close</button>
                            </div>
                        ) : reorgData?.recommendations?.length > 0 ? (
                            <>
                                <div className="data-table-wrapper"><table className="data-table">
                                    <thead>
                                        <tr>
                                            <th style={{ width: '40px' }}></th>
                                            <th>Name</th>
                                            <th>Current Stage</th>
                                            <th>Recommended</th>
                                            <th>Reason</th>
                                            <th style={{ textAlign: 'center' }}>Confidence</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {reorgData.recommendations.map((r: any) => (
                                            <tr key={r.opportunityId}>
                                                <td>
                                                    <input
                                                        type="checkbox"
                                                        checked={reorgSelected.has(r.opportunityId)}
                                                        onChange={(e) => {
                                                            const next = new Set(reorgSelected);
                                                            e.target.checked ? next.add(r.opportunityId) : next.delete(r.opportunityId);
                                                            setReorgSelected(next);
                                                        }}
                                                    />
                                                </td>
                                                <td style={{ fontWeight: 600 }}>{r.contactName}</td>
                                                <td style={{ fontSize: '0.8125rem' }}>{r.currentStageName}</td>
                                                <td style={{ fontSize: '0.8125rem', color: '#60A5FA' }}>{r.recommendedStageName}</td>
                                                <td style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', maxWidth: '200px' }}>{r.reason}</td>
                                                <td style={{ textAlign: 'center' }}>
                                                    <span style={{
                                                        padding: '2px 8px', borderRadius: '4px', fontSize: '0.6875rem', fontWeight: 700,
                                                        background: r.confidence === 'high' ? 'rgba(52,211,153,0.15)' : 'rgba(251,191,36,0.15)',
                                                        color: r.confidence === 'high' ? '#34D399' : '#FBBF24',
                                                    }}>
                                                        {r.confidence}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table></div>
                                <div style={{ marginTop: '16px', display: 'flex', gap: '12px' }}>
                                    <button
                                        className="period-btn active"
                                        onClick={applyReorgMoves}
                                        disabled={reorgApplying || reorgSelected.size === 0}
                                    >
                                        {reorgApplying ? 'Applying...' : `Apply ${reorgSelected.size} Move${reorgSelected.size !== 1 ? 's' : ''}`}
                                    </button>
                                    <button className="period-btn" onClick={() => setReorgOpen(false)}>Cancel</button>
                                </div>
                            </>
                        ) : (
                            <p style={{ color: 'var(--text-muted)' }}>No stage recommendations at this time.</p>
                        )}
                    </div>
                </div>
            )}

            {/* ═══════════════════════════════════════════════════ */}
            {/* Modal: Transcript Viewer */}
            {/* ═══════════════════════════════════════════════════ */}
            {transcriptOpen && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '24px' }}
                    onClick={(e) => { if (e.target === e.currentTarget) setTranscriptOpen(false); }}>
                    <div style={{ background: '#1a2332', borderRadius: '16px', border: '1px solid var(--border-subtle)', maxWidth: '600px', width: '100%', maxHeight: '80vh', overflow: 'auto', padding: '32px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                            <h3 style={{ margin: 0 }}>Call Transcript — {transcriptContactName}</h3>
                            <button onClick={() => setTranscriptOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.25rem' }}>x</button>
                        </div>
                        <div style={{ padding: '8px', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: '8px', marginBottom: '16px', fontSize: '0.75rem', color: '#F87171' }}>
                            PHI Warning: This transcript may contain protected health information.
                        </div>
                        {transcriptLoading ? (
                            <p style={{ color: 'var(--text-muted)' }}>Loading transcript...</p>
                        ) : transcriptData?.segments?.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {transcriptData.segments.map((seg: any, i: number) => (
                                    <div key={i} style={{
                                        padding: '8px 12px', borderRadius: '8px',
                                        background: seg.mediaChannel === 2 ? 'rgba(96,165,250,0.08)' : 'rgba(255,255,255,0.04)',
                                        borderLeft: `3px solid ${seg.mediaChannel === 2 ? '#60A5FA' : '#94A3B8'}`,
                                    }}>
                                        <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
                                            {seg.mediaChannel === 2 ? 'Staff' : 'Patient'} | {seg.startTime}
                                        </div>
                                        <div style={{ fontSize: '0.8125rem' }}>{seg.transcript}</div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p style={{ color: 'var(--text-muted)' }}>No transcript available.</p>
                        )}
                    </div>
                </div>
            )}

            {/* ═══════════════════════════════════════════════════ */}
            {/* Modal: SMS/Email Campaign Wizard */}
            {/* ═══════════════════════════════════════════════════ */}
            {smsOpen && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '24px' }}
                    onClick={(e) => { if (e.target === e.currentTarget) setSmsOpen(false); }}>
                    <div style={{ background: '#1a2332', borderRadius: '16px', border: '1px solid var(--border-subtle)', maxWidth: '900px', width: '100%', maxHeight: '85vh', overflow: 'auto', padding: '32px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                            <h2 style={{ margin: 0 }}>
                                {CAMPAIGN_SEGMENTS.find(s => s.id === smsSegment)?.label || smsSegment} Campaign
                            </h2>
                            <button onClick={() => setSmsOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.25rem' }}>x</button>
                        </div>

                        {/* Step indicator */}
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
                            {[1, 2, 3].map(s => (
                                <div key={s} style={{
                                    flex: 1, height: '4px', borderRadius: '2px',
                                    background: s <= smsStep ? 'var(--accent-primary)' : 'rgba(255,255,255,0.1)',
                                }} />
                            ))}
                        </div>

                        {smsError && (
                            <div style={{ padding: '12px', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: '8px', marginBottom: '16px', color: '#F87171', fontSize: '0.875rem' }}>
                                {smsError}
                            </div>
                        )}

                        {/* Step 1: Loading / Forecast */}
                        {smsStep === 1 && (
                            <>
                                {smsLoading ? (
                                    <div className="empty-state">
                                        <h3>Loading eligible contacts...</h3>
                                        <p>Applying cooldowns, DND checks, and conversation filters</p>
                                    </div>
                                ) : smsData ? (
                                    <>
                                        {/* Channel toggle */}
                                        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                                            {(['sms', 'email'] as const).map(ch => (
                                                <button
                                                    key={ch}
                                                    className={`period-btn ${smsChannel === ch ? 'active' : ''}`}
                                                    onClick={() => {
                                                        setSmsChannel(ch);
                                                        // Reload template for new channel
                                                        if (ch === 'email') {
                                                            const et = smsData.emailTemplates?.[smsSegment];
                                                            if (et?.template) { setSmsMessage(et.template); setSmsSubject(et.subject || ''); }
                                                        } else {
                                                            const t = smsData.templates?.[smsSegment];
                                                            if (t?.template) setSmsMessage(t.template);
                                                        }
                                                    }}
                                                >
                                                    {ch.toUpperCase()}
                                                </button>
                                            ))}
                                        </div>

                                        {/* Forecast */}
                                        {smsData.forecast && (
                                            <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: '16px' }}>
                                                <div className="metric-card">
                                                    <div className="label">Eligible</div>
                                                    <div className="value">{smsData.forecast.targetContacts}</div>
                                                </div>
                                                <div className="metric-card">
                                                    <div className="label">Est. Responses</div>
                                                    <div className="value">{smsData.forecast.predictedResponses}</div>
                                                    <div className="change">{smsData.forecast.predictedResponseRate}% rate</div>
                                                </div>
                                                <div className="metric-card">
                                                    <div className="label">Est. Bookings</div>
                                                    <div className="value">{smsData.forecast.predictedBookings}</div>
                                                </div>
                                                <div className="metric-card">
                                                    <div className="label">Projected Revenue</div>
                                                    <div className="value" style={{ color: '#34D399' }}>{formatCurrency(smsData.forecast.projectedRevenue)}</div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Exclusion info */}
                                        <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
                                            {smsData.dndFiltered > 0 && <span>{smsData.dndFiltered} DND excluded | </span>}
                                            {smsData.cooldownExcluded > 0 && <span>{smsData.cooldownExcluded} cooldown excluded | </span>}
                                            {smsData.outboundExcluded > 0 && <span>{smsData.outboundExcluded} recent outbound excluded</span>}
                                        </div>

                                        <button
                                            className="period-btn active"
                                            onClick={() => setSmsStep(2)}
                                            disabled={!smsData.contacts?.length}
                                        >
                                            Review Contacts & Message ({smsData.contacts?.length || 0})
                                        </button>
                                    </>
                                ) : null}
                            </>
                        )}

                        {/* Step 2: Review + Edit Message */}
                        {smsStep === 2 && smsData && (
                            <>
                                {/* Location filter */}
                                <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
                                    {['all', 'decatur', 'smyrna', 'kennesaw'].map(loc => (
                                        <button
                                            key={loc}
                                            className={`period-btn ${smsLocationFilter === loc ? 'active' : ''}`}
                                            onClick={() => setSmsLocationFilter(loc)}
                                            style={{ fontSize: '0.75rem', padding: '4px 10px' }}
                                        >
                                            {loc === 'all' ? 'All Locations' : loc === 'smyrna' ? 'Smyrna' : loc.charAt(0).toUpperCase() + loc.slice(1)}
                                        </button>
                                    ))}
                                </div>

                                {/* Message editor */}
                                <div style={{ marginBottom: '16px' }}>
                                    {smsChannel === 'email' && (
                                        <input
                                            type="text"
                                            value={smsSubject}
                                            onChange={e => setSmsSubject(e.target.value)}
                                            placeholder="Email subject line"
                                            style={{
                                                width: '100%', padding: '10px 14px', marginBottom: '8px',
                                                background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-subtle)',
                                                borderRadius: '8px', color: 'var(--text-primary)', fontSize: '0.875rem',
                                            }}
                                        />
                                    )}
                                    <textarea
                                        value={smsMessage}
                                        onChange={e => setSmsMessage(e.target.value)}
                                        rows={smsChannel === 'email' ? 8 : 4}
                                        style={{
                                            width: '100%', padding: '12px 14px',
                                            background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-subtle)',
                                            borderRadius: '8px', color: 'var(--text-primary)', fontSize: '0.875rem',
                                            resize: 'vertical',
                                        }}
                                    />
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                                        Use {'{{firstName}}'} for personalization. {smsChannel === 'sms' ? `${smsMessage.length}/160 chars` : ''}
                                    </div>
                                </div>

                                {/* Contact list preview */}
                                <div style={{ maxHeight: '200px', overflow: 'auto', marginBottom: '16px', border: '1px solid var(--border-subtle)', borderRadius: '8px' }}>
                                    <table className="data-table" style={{ fontSize: '0.8125rem' }}>
                                        <thead>
                                            <tr>
                                                <th style={{ width: '30px' }}>
                                                    <input type="checkbox"
                                                        checked={smsSelected.size === (smsData.contacts?.length || 0)}
                                                        onChange={e => {
                                                            if (e.target.checked) {
                                                                setSmsSelected(new Set(smsData.contacts.map((c: any) => c.contactId)));
                                                            } else {
                                                                setSmsSelected(new Set());
                                                            }
                                                        }}
                                                    />
                                                </th>
                                                <th>Name</th>
                                                <th>Phone</th>
                                                <th>Location</th>
                                                <th>Stage</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {(smsLocationFilter === 'all'
                                                ? smsData.contacts
                                                : smsData.contacts.filter((c: any) => c.locationKey === smsLocationFilter)
                                            )?.slice(0, 50).map((c: any) => (
                                                <tr key={c.contactId}>
                                                    <td>
                                                        <input type="checkbox"
                                                            checked={smsSelected.has(c.contactId)}
                                                            onChange={e => {
                                                                const next = new Set(smsSelected);
                                                                e.target.checked ? next.add(c.contactId) : next.delete(c.contactId);
                                                                setSmsSelected(next);
                                                            }}
                                                        />
                                                    </td>
                                                    <td>{c.contactName}</td>
                                                    <td style={{ color: 'var(--text-muted)' }}>{c.maskedPhone}</td>
                                                    <td>{c.locationName}</td>
                                                    <td style={{ color: 'var(--text-muted)' }}>{c.stageName}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Action buttons */}
                                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                    <button className="period-btn" onClick={() => setSmsStep(1)}>Back</button>
                                    <button
                                        className="period-btn"
                                        onClick={sendTestMessage}
                                        disabled={smsTestSending}
                                        style={{ borderColor: '#FBBF24', color: '#FBBF24' }}
                                    >
                                        {smsTestSending ? 'Sending...' : 'Send Test'}
                                    </button>
                                    <button
                                        className="period-btn active"
                                        onClick={sendSmsCampaign}
                                        disabled={smsSending || smsSelected.size === 0}
                                    >
                                        {smsSending ? 'Sending...' : `Send to ${smsSelected.size} Contact${smsSelected.size !== 1 ? 's' : ''}`}
                                    </button>
                                </div>
                                {smsTestResult && (
                                    <div style={{
                                        marginTop: '8px', fontSize: '0.8125rem',
                                        color: smsTestResult.success ? '#34D399' : '#F87171',
                                    }}>
                                        {smsTestResult.message}
                                    </div>
                                )}
                            </>
                        )}

                        {/* Step 3: Results */}
                        {smsStep === 3 && smsResults && (
                            <div style={{ textAlign: 'center', padding: '24px 0' }}>
                                <div style={{ fontSize: '2rem', fontWeight: 700, color: '#34D399', marginBottom: '8px' }}>
                                    {smsResults.sent} Sent
                                </div>
                                {smsResults.failed > 0 && (
                                    <div style={{ color: '#F87171', marginBottom: '8px' }}>{smsResults.failed} failed</div>
                                )}
                                {smsResults.skipped > 0 && (
                                    <div style={{ color: '#FBBF24', marginBottom: '8px' }}>{smsResults.skipped} skipped (DND/missing)</div>
                                )}
                                {smsResults.errors?.length > 0 && (
                                    <div style={{ color: '#F87171', fontSize: '0.8125rem', marginTop: '8px' }}>
                                        {smsResults.errors.map((e: string, i: number) => <div key={i}>{e}</div>)}
                                    </div>
                                )}
                                <button className="period-btn active" onClick={() => setSmsOpen(false)} style={{ marginTop: '24px' }}>
                                    Close
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    );
}
