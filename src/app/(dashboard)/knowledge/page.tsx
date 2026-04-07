'use client';

import { useState } from 'react';

type Tab = 'start' | 'analytics' | 'leads' | 'content' | 'reputation' | 'admin';

const TABS: { id: Tab; label: string }[] = [
    { id: 'start', label: 'Getting Started' },
    { id: 'analytics', label: 'Analytics' },
    { id: 'leads', label: 'Leads & Pipeline' },
    { id: 'content', label: 'Content' },
    { id: 'reputation', label: 'Reputation' },
    { id: 'admin', label: 'Admin' },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="section-card" style={{ marginBottom: '20px' }}>
            <h3 style={{ marginBottom: '16px', fontSize: '1.125rem' }}>{title}</h3>
            {children}
        </div>
    );
}

function Feature({ name, source, features, notes }: {
    name: string;
    source: string;
    features: string[];
    notes?: string[];
}) {
    return (
        <div style={{ marginBottom: '24px', paddingBottom: '24px', borderBottom: '1px solid var(--border-subtle)' }}>
            <h4 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '8px' }}>{name}</h4>
            <div style={{ display: 'inline-block', padding: '2px 10px', borderRadius: '4px', background: 'rgba(96,165,250,0.1)', color: '#60A5FA', fontSize: '0.75rem', fontWeight: 600, marginBottom: '12px' }}>
                {source}
            </div>
            <div style={{ marginBottom: notes ? '12px' : 0 }}>
                <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>Key Features</div>
                <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                    {features.map((f, i) => <li key={i}>{f}</li>)}
                </ul>
            </div>
            {notes && notes.length > 0 && (
                <div style={{ padding: '12px', background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.15)', borderRadius: '8px', marginTop: '12px' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#FBBF24', marginBottom: '6px' }}>Things to Know</div>
                    <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '0.8125rem', color: 'var(--text-muted)', lineHeight: 1.7 }}>
                        {notes.map((n, i) => <li key={i}>{n}</li>)}
                    </ul>
                </div>
            )}
        </div>
    );
}

export default function KnowledgeBasePage() {
    const [tab, setTab] = useState<Tab>('start');

    return (
        <>
            <div className="page-header">
                <h1>Knowledge Base</h1>
                <p className="subtitle">Everything you need to know about the Chin Up! Marketing Dashboard</p>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: '4px', marginBottom: '24px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0', flexWrap: 'wrap' }}>
                {TABS.map(t => (
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

            {/* ══════════════════════════════════════ */}
            {/* Getting Started */}
            {/* ══════════════════════════════════════ */}
            {tab === 'start' && (
                <>
                    <Section title="What Is This Dashboard?">
                        <p style={{ fontSize: '0.9375rem', color: 'var(--text-secondary)', lineHeight: 1.8, marginBottom: '16px' }}>
                            The Chin Up! Marketing Dashboard is a centralized command center for all marketing activities across Decatur, Smyrna/Vinings, and Kennesaw locations. It pulls data from 6+ platforms into one unified view so you can make decisions without logging into multiple tools.
                        </p>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                            {[
                                { label: 'MindBody', desc: 'POS, appointments, client data' },
                                { label: 'GoHighLevel', desc: 'CRM, pipelines, conversations' },
                                { label: 'Meta (FB + IG)', desc: 'Organic posts & paid ads' },
                                { label: 'YouTube', desc: 'Channel & video analytics' },
                                { label: 'TikTok', desc: 'Organic video performance' },
                                { label: 'Google', desc: 'Search Console, Ads, Business' },
                            ].map(p => (
                                <div key={p.label} style={{ padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                                    <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '4px' }}>{p.label}</div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{p.desc}</div>
                                </div>
                            ))}
                        </div>
                    </Section>

                    <Section title="Users & Roles">
                        <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                            <p style={{ marginBottom: '12px' }}>There are two roles in the dashboard:</p>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                <div style={{ padding: '16px', background: 'rgba(216,180,29,0.06)', border: '1px solid rgba(216,180,29,0.2)', borderRadius: '8px' }}>
                                    <div style={{ fontWeight: 700, marginBottom: '8px', color: '#D8B41D' }}>Admin</div>
                                    <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '0.8125rem', lineHeight: 1.8, color: 'var(--text-secondary)' }}>
                                        <li>Sees all revenue and dollar values</li>
                                        <li>Access to Settings (users, API keys, sync)</li>
                                        <li>Can run SMS/Email campaigns</li>
                                        <li>Can reorganize pipeline stages</li>
                                        <li>Full access to all features</li>
                                    </ul>
                                </div>
                                <div style={{ padding: '16px', background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.2)', borderRadius: '8px' }}>
                                    <div style={{ fontWeight: 700, marginBottom: '8px', color: '#60A5FA' }}>Marketing Manager</div>
                                    <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '0.8125rem', lineHeight: 1.8, color: 'var(--text-secondary)' }}>
                                        <li>All analytics and lead data (counts, not dollars)</li>
                                        <li>Content publishing and scheduling</li>
                                        <li>Research and competitor analysis</li>
                                        <li>Revenue values are hidden (shows counts only)</li>
                                        <li>No access to Settings page</li>
                                    </ul>
                                </div>
                            </div>
                        </div>
                    </Section>

                    <Section title="Navigation Guide">
                        <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {[
                                    { icon: 'Overview', route: '/', desc: 'High-level KPIs across all platforms — your daily snapshot' },
                                    { icon: 'Organic', route: '/organic', desc: 'Instagram, Facebook, YouTube, and TikTok organic performance' },
                                    { icon: 'Paid Ads', route: '/ads', desc: 'Meta Ads and Google Ads campaign performance + ROAS' },
                                    { icon: 'Leads & Pipeline', route: '/attribution', desc: 'GHL pipeline summary, conversation-based lead outreach, campaigns' },
                                    { icon: 'Research', route: '/research', desc: 'Social trends, competitor analysis, content calendar, market intel' },
                                    { icon: 'Publish', route: '/publish', desc: 'Schedule and publish content to Facebook, Instagram, and Google Business' },
                                    { icon: 'Content', route: '/content', desc: 'Unified view of all published content across Instagram and YouTube' },
                                    { icon: 'Creatives', route: '/creatives', desc: 'AI-generated marketing images via Kie.ai' },
                                    { icon: 'Reputation', route: '/reputation', desc: 'Google reviews, Search Console rankings, competitor tracking' },
                                    { icon: 'Knowledge', route: '/knowledge', desc: 'This page — documentation for all dashboard features' },
                                    { icon: 'Settings', route: '/settings', desc: 'Admin: manage users, connect accounts, monitor API usage, trigger syncs' },
                                ].map(item => (
                                    <div key={item.route} style={{ display: 'flex', gap: '16px', padding: '10px 14px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', alignItems: 'center' }}>
                                        <span style={{ fontWeight: 600, width: '140px', flexShrink: 0 }}>{item.icon}</span>
                                        <span style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', fontFamily: 'monospace', width: '120px', flexShrink: 0 }}>{item.route}</span>
                                        <span style={{ fontSize: '0.8125rem' }}>{item.desc}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </Section>
                </>
            )}

            {/* ══════════════════════════════════════ */}
            {/* Analytics */}
            {/* ══════════════════════════════════════ */}
            {tab === 'analytics' && (
                <>
                    <Section title="Organic Analytics">
                        <Feature
                            name="Instagram"
                            source="Meta Graph API | Refreshes on page load (cached 4 hours)"
                            features={[
                                'Follower count and growth over time',
                                'Reach, impressions, profile views, website clicks',
                                'Post-level performance (likes, comments, shares, saves)',
                                'Stories and Reels analytics',
                                'Period comparison: 7d, 30d, 90d',
                            ]}
                            notes={[
                                'Instagram daily metrics (reach, follower_count) can only look back 30 days from today',
                                'Aggregate metrics (views, likes, comments) use metric_type=total_value and cannot be mixed with daily metrics in one API call',
                                'Follower count is a snapshot metric — historical growth is computed from stored daily values',
                            ]}
                        />
                        <Feature
                            name="Facebook"
                            source="Meta Graph API | Refreshes on page load (cached 4 hours)"
                            features={[
                                'Page follows and page views',
                                'Post engagements (reactions, comments, shares)',
                                'Video views across all page videos',
                                'Post-level breakdown with reach and engagement rate',
                            ]}
                            notes={[
                                'Facebook deprecated page_impressions, page_fans, page_engaged_users, and page_media_views in November 2025',
                                'Valid metrics now: page_follows, page_views_total, page_post_engagements, page_video_views',
                                'Uses a permanent page token that works for both FB and IG',
                            ]}
                        />
                        <Feature
                            name="YouTube"
                            source="YouTube Data API v3 | API Key (no OAuth) | 10,000 units/day"
                            features={[
                                'Subscriber count, total views, total videos',
                                'Per-video performance (views, likes, comments)',
                                'Most recent uploads with thumbnail previews',
                                'Cost-efficient: uses playlistItems.list (1 unit) instead of search.list (100 units)',
                            ]}
                            notes={[
                                'Subscriber count is rounded by YouTube (e.g., 1,234 shows as "1.23K")',
                                'Uses ~3 API units per refresh — well within the 10,000/day quota',
                                'Uploads playlist ID is derived from channel ID (UC prefix becomes UU)',
                            ]}
                        />
                        <Feature
                            name="TikTok"
                            source="TikTok API v2 (OAuth 2.0) | Free, 600 req/min"
                            features={[
                                'Video list with view counts, likes, comments, shares',
                                'Follower count from user profile',
                                'Video thumbnail previews (note: URLs expire after 6 hours)',
                                'Top sounds and hashtags analysis',
                                'Breakout video detection (10x+ average views)',
                            ]}
                            notes={[
                                'Access token expires every 24 hours — auto-refreshed using the refresh token',
                                'Refresh token lasts 365 days but the returned token may change — always stores the latest',
                                'NOT available from TikTok API: profile views, audience demographics, watch time, follower growth time series',
                                'Cover image URLs have a 6-hour TTL — they expire and need re-fetching',
                            ]}
                        />
                        <Feature
                            name="Unified Content View"
                            source="All platform data combined | Content tab in Organic"
                            features={[
                                'Cross-platform content table with all Instagram and YouTube posts in one view',
                                'Sortable by views, likes, comments, shares, engagement rate',
                                'Platform and media type filters',
                                'Top posts leaderboard across all platforms',
                                'Best time to post analysis based on historical engagement data',
                            ]}
                        />
                    </Section>

                    <Section title="Paid Ads">
                        <Feature
                            name="Meta Ads (Facebook + Instagram)"
                            source="Meta Marketing API | Uses user access token (long-lived)"
                            features={[
                                'Campaign-level spend, impressions, clicks, CTR, CPC, CPM',
                                'Industry benchmarks with A-F grading vs. med spa averages (CTR, CPM, Cost/Lead, ROAS)',
                                'Per-campaign breakdown with sortable table and status filtering (Active/Paused/All)',
                                'Lead form integration — counts leads per campaign',
                                'Appointment attribution: booked and completed appointments per campaign (MindBody cross-reference)',
                                'Ad copy fetching — view the creative text for each campaign',
                                'AI Campaign Analysis — Claude-powered grading with priority actions and creative suggestions (expand/collapse per campaign)',
                            ]}
                            notes={[
                                'User access token expires ~60 days — check Settings for expiration date',
                                'Current token expires May 25, 2026 — needs regeneration before then',
                                'Ad account must be connected via Settings page',
                            ]}
                        />
                        <Feature
                            name="Google Ads"
                            source="Google Ads API | OAuth 2.0"
                            features={[
                                'Campaign spend, impressions, clicks, CTR, CPC, conversions',
                                'Per-campaign performance table',
                                'Period comparison: 7d, 30d, 90d',
                            ]}
                        />
                        <Feature
                            name="ROAS Reconciliation"
                            source="Cross-referenced: Meta Lead Forms (email) vs. MindBody sales"
                            features={[
                                'True ROAS: matches Meta lead form emails to MindBody purchasing clients',
                                'Meta ROAS vs. True ROAS side-by-side comparison',
                                'Per-campaign ROAS breakdown with matched client count',
                                'Match rate tracking (what % of leads became paying clients)',
                                'Cost per matched client calculation',
                                'Detailed modal: see each matched patient, their revenue, lead cost, and individual ROAS',
                                'Split attribution when a patient submitted multiple lead forms',
                            ]}
                            notes={[
                                'Requires a Lead Generation campaign with native Facebook forms (email collection)',
                                'Matching is done by email address — accuracy depends on leads using the same email in MindBody',
                                'Admin-only feature — marketing managers see lead counts but not dollar values',
                            ]}
                        />
                    </Section>
                </>
            )}

            {/* ══════════════════════════════════════ */}
            {/* Leads & Pipeline */}
            {/* ══════════════════════════════════════ */}
            {tab === 'leads' && (
                <>
                    <Section title="How Lead Intelligence Works">
                        <div style={{ padding: '16px', background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.2)', borderRadius: '8px', marginBottom: '20px', fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                            <strong>Conversation-first approach:</strong> Instead of relying on pipeline stage position (which is only ~80% accurate), the dashboard analyzes actual SMS, call, and email history from GoHighLevel to determine where each lead truly stands. Pipeline timestamps are only used as a fallback for contacts with zero conversation history.
                        </div>
                        <Feature
                            name="Pipeline Summary"
                            source="GoHighLevel v1 API | 3 locations | Cached 15 minutes"
                            features={[
                                'Total open, won, lost opportunities across Decatur, Smyrna, and Kennesaw',
                                'Conversion rate (won / (won + lost))',
                                'Per-location comparison table',
                                'Lifecycle breakdown chart (from conversation analysis)',
                                'Speed-to-lead: average time to first outbound message per location',
                            ]}
                            notes={[
                                'Pipeline data shows the GHL view — stage names and counts match what you see in GoHighLevel',
                                'Lifecycle breakdown requires loading the "Leads & Outreach" tab at least once to populate conversation data',
                            ]}
                        />
                    </Section>

                    <Section title="Leads & Outreach (Action Tab)">
                        <Feature
                            name="Call Priority List"
                            source="GHL v2 Conversations API | Analyzes top 150 contacts | Cached 30 minutes"
                            features={[
                                '"Who to call next" — sorted by call priority score (0-100)',
                                'Priority weights: lifecycle stage (30%), recency (30%), monetary value (20%), conversation depth (10%), unreplied inbound (10%)',
                                'Lifecycle stage badges: untouched, attempted, engaged, quoted, ghost, converted',
                                'Suggested action text for each contact (e.g., "Sent 3 texts with no reply. Try calling instead.")',
                                'Copy phone number button for quick action',
                                'Pipeline Reorganization: AI-powered stage move recommendations based on conversation data',
                            ]}
                            notes={[
                                'Analysis is capped at 150 contacts per run to respect GHL API rate limits (100 req/10s)',
                                'Contacts are prioritized by a blend of monetary value (60%) and recency (40%)',
                                'Contacts beyond the 150 cap get timestamp-only classification (shown with "Limited Data" indicator)',
                                'DND contacts and active MindBody patients (purchased within 120 days) are automatically excluded',
                            ]}
                        />
                        <Feature
                            name="Lifecycle Stages Explained"
                            source="Computed from GHL v2 conversation messages"
                            features={[
                                'Untouched — Zero messages ever sent or received. No one has reached out.',
                                'Attempted — Your team sent outbound messages, but the lead never replied.',
                                'Engaged — Two-way conversation is happening (inbound + outbound messages).',
                                'Quoted — Pricing or services were discussed in outbound messages (keywords: price, cost, treatment, consultation, etc.).',
                                'Ghost — Was engaged (3+ messages exchanged), then went silent for 14+ days.',
                                'Converted — Opportunity status is "won" in GHL.',
                            ]}
                        />
                        <Feature
                            name="Ghost Analytics"
                            source="Computed from conversation history"
                            features={[
                                'Average messages before a lead ghosts — shows how deep conversations get before drop-off',
                                'Average days to ghost — how long from first outbound to silence',
                                'Ghost rate by lead source — which channels produce leads that ghost most',
                                'Ghost rate by location — which offices have higher ghost rates',
                            ]}
                        />
                        <Feature
                            name="Lost Revenue Candidates"
                            source="GHL opportunities + conversation history (admin-only values)"
                            features={[
                                'Contacts in ghost or quoted lifecycle with 14+ days of silence',
                                'Shows monetary value at risk from each candidate',
                                'Cards display contact name, location, pipeline stage, days silent, conversation count',
                            ]}
                        />
                    </Section>

                    <Section title="Campaigns">
                        <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.8, marginBottom: '16px' }}>
                            Admin-only feature. Send targeted SMS or email campaigns to specific segments of leads. All campaigns apply three layers of protection:
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '20px' }}>
                            <div style={{ padding: '12px', background: 'rgba(52,211,153,0.06)', borderRadius: '8px', textAlign: 'center' }}>
                                <div style={{ fontWeight: 600, fontSize: '0.875rem', color: '#34D399', marginBottom: '4px' }}>30-Day Cooldown</div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>No duplicate contacts within 30 days</div>
                            </div>
                            <div style={{ padding: '12px', background: 'rgba(52,211,153,0.06)', borderRadius: '8px', textAlign: 'center' }}>
                                <div style={{ fontWeight: 600, fontSize: '0.875rem', color: '#34D399', marginBottom: '4px' }}>7-Day Outbound</div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Skips anyone messaged via GHL in last 7 days</div>
                            </div>
                            <div style={{ padding: '12px', background: 'rgba(52,211,153,0.06)', borderRadius: '8px', textAlign: 'center' }}>
                                <div style={{ fontWeight: 600, fontSize: '0.875rem', color: '#34D399', marginBottom: '4px' }}>DND Filtering</div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Checks both v1 global and v2 per-channel SMS DND</div>
                            </div>
                        </div>
                        <Feature
                            name="Conversation-Based Segments"
                            source="GHL v2 Conversations API"
                            features={[
                                'Never Contacted — Leads with zero outreach attempts',
                                'Attempted, No Reply — Outbound sent 7+ days ago, no response',
                                'Re-engage Ghosts — Was engaged, silent 14-60 days',
                                'Quoted, Not Booked — Discussed pricing 7+ days ago, no booking',
                            ]}
                        />
                        <Feature
                            name="MindBody-Based Segments"
                            source="MindBody appointment & sales history (via Postgres backfill)"
                            features={[
                                'Cancelled Appointments — Patients who cancelled, cross-referenced with GHL for phone',
                                'Consulted, Not Treated — Had consultation but never booked treatment',
                                'Lapsed VIPs ($500+) — High-value patients, 120-365 days since last visit',
                                'Long-Lapsed — 180+ days since last visit',
                                'Win-Back VIPs — $500+ revenue, 365+ days absent',
                                'Treatment-Specific — Filter by treatment type (Botox, Filler, etc.), 90+ days',
                            ]}
                        />
                    </Section>
                </>
            )}

            {/* ══════════════════════════════════════ */}
            {/* Content */}
            {/* ══════════════════════════════════════ */}
            {tab === 'content' && (
                <>
                    <Section title="Research Hub">
                        <Feature
                            name="Trend Scout"
                            source="Claude AI + social data analysis"
                            features={[
                                'AI-generated content ideas scored 0-100 on opportunity potential',
                                '11-point scoring: search volume, competition, audience fit, content gap, trend momentum, and more',
                                'Focus filters: seasonal, competitor gap, trending, evergreen, local',
                                'Actionable content briefs with suggested formats, hooks, and CTAs',
                                'Copy-to-clipboard for quick content creation',
                            ]}
                        />
                        <Feature
                            name="Content Calendar"
                            source="Claude AI + real business data context"
                            features={[
                                'AI-generated monthly content calendar tailored to your business',
                                'Incorporates real data: top-performing posts, audience insights, seasonal trends',
                                'Calendar grid with day-by-day content suggestions',
                                'Queue button to add calendar items directly to publishing queue',
                                'Month navigation with regeneration on demand',
                            ]}
                        />
                        <Feature
                            name="Market Intelligence"
                            source="Claude AI + Google Search Console + social data"
                            features={[
                                'AI-powered market analysis for the med spa industry',
                                'Local market insights for the Atlanta metro area',
                                'Treatment trend analysis with seasonal patterns',
                                'Competitive positioning recommendations',
                                'Content strategy suggestions based on search data',
                            ]}
                            notes={[
                                'Search Console data has a 2-3 day delay from Google',
                                'Social posts are synced to Postgres daily for unlimited historical lookback',
                            ]}
                        />
                        <Feature
                            name="Competitor Watch"
                            source="Public social data + Instagram API"
                            features={[
                                'Track competitor social activity and posting frequency',
                                'Compare engagement rates across competitors',
                                'Radar chart comparing your metrics vs. competitors',
                                'Content gap analysis — what competitors post that you don\'t',
                            ]}
                        />
                        <Feature
                            name="Content Analysis"
                            source="Postgres social_posts sync"
                            features={[
                                'Category breakdown of your content (educational, promotional, behind-the-scenes, etc.)',
                                'Performance by content category with engagement comparison',
                                'Content mix recommendations',
                            ]}
                        />
                    </Section>

                    <Section title="Publish">
                        <Feature
                            name="Content Publishing"
                            source="Meta Graph API + Google Business Profile via GHL"
                            features={[
                                'Publish to Facebook Pages and Instagram (feed posts, Reels, Stories)',
                                'Google Business Profile posting via GoHighLevel Social Planner (Decatur, Smyrna, Kennesaw)',
                                'Schedule posts for future dates and times (all times in Eastern Time)',
                                'Calendar view: visual month grid showing scheduled posts per day',
                                'Bulk upload via CSV: upload multiple posts with captions and scheduling',
                                'AI caption suggestions powered by Claude',
                                'Gallery integration: use AI-generated creatives directly in posts',
                                'Publishing history with status tracking (Live, Failed, Partial)',
                                'Weekly content goals scorecard with per-platform progress tracking',
                            ]}
                            notes={[
                                'Instagram Reels require video files; Stories require 9:16 aspect ratio',
                                'Google Business Profile posting uses GHL\'s Social Planner API — Google\'s direct API (v4) is dead and newer APIs have quota=0',
                                'Scheduled posts are published automatically by a cron job',
                                'Images and videos are stored in Vercel Blob storage (10MB images, 100MB videos)',
                            ]}
                        />
                    </Section>

                    <Section title="Creatives">
                        <Feature
                            name="AI Image Generation"
                            source="Kie.ai (Nano Banana 2 model) | Pay-per-generation"
                            features={[
                                'Generate marketing images from text prompts',
                                'Brand profile system — saves your brand colors, style, and preferences',
                                'Tag and organize generated creatives',
                                'Download or use directly in publishing workflow',
                                'Generation history with all past creatives',
                            ]}
                            notes={[
                                'Request body uses "model" (not "modelId") and "input" (not "params")',
                                'Generation takes 15-60 seconds — the dashboard polls every 5 seconds',
                                'Image URLs from Kie.ai expire in 24 hours — images are automatically re-uploaded to Vercel Blob for permanent storage',
                                'Response nesting varies — the system checks data.data, data.record, and data as fallbacks',
                            ]}
                        />
                    </Section>
                </>
            )}

            {/* ══════════════════════════════════════ */}
            {/* Reputation */}
            {/* ══════════════════════════════════════ */}
            {tab === 'reputation' && (
                <>
                    <Section title="Reputation Management">
                        <Feature
                            name="Reviews"
                            source="Google Business Profile API"
                            features={[
                                'Aggregate review scores across all locations',
                                'Recent review feed with star ratings and text',
                                'Review volume trends over time',
                            ]}
                        />
                        <Feature
                            name="Competitor Analysis"
                            source="Manual tracking + public data"
                            features={[
                                'Side-by-side comparison with configured competitors',
                                'Review count and rating comparisons',
                                'Notes and observations per competitor',
                            ]}
                            notes={[
                                'Competitors are configured in the Settings page',
                                'Data is pulled from publicly available sources — no private competitor data',
                            ]}
                        />
                        <Feature
                            name="Search Rankings"
                            source="Google Search Console API | Daily sync to Postgres"
                            features={[
                                'Track keyword positions over time',
                                'Click-through rates by search query',
                                'Page-level performance breakdown',
                                'Impression and click trends',
                            ]}
                        />
                    </Section>
                </>
            )}

            {/* ══════════════════════════════════════ */}
            {/* Admin */}
            {/* ══════════════════════════════════════ */}
            {tab === 'admin' && (
                <>
                    <Section title="Settings (Admin-Only)">
                        <Feature
                            name="User Management"
                            source="Local auth system (NextAuth.js)"
                            features={[
                                'Add and remove dashboard users',
                                'Set roles: admin or marketing_manager',
                                'View login history and last active timestamps',
                                'Password management',
                            ]}
                        />
                        <Feature
                            name="Connected Accounts"
                            source="Settings page"
                            features={[
                                'Connect/disconnect social platform APIs',
                                'View token status and expiration dates',
                                'Test API connections',
                            ]}
                        />
                        <Feature
                            name="API Usage Monitoring"
                            source="Internal tracking"
                            features={[
                                'See API call counts per platform',
                                'Monitor quota usage (YouTube 10K/day, MindBody 5K/month, etc.)',
                                'Cost estimates for paid APIs',
                            ]}
                        />
                        <Feature
                            name="Data Sync"
                            source="Settings page"
                            features={[
                                'Trigger manual data syncs (MindBody clients, sales, appointments)',
                                'GHL contacts backfill and incremental sync',
                                'View sync status, last run time, total records',
                                'Resumable backfills with progress tracking (for Vercel 60s limit)',
                            ]}
                        />
                    </Section>

                    <Section title="Data Sources & Refresh Rates">
                        <div className="data-table-wrapper"><table className="data-table">
                            <thead>
                                <tr>
                                    <th>Data Source</th>
                                    <th>Refresh Rate</th>
                                    <th>Quota</th>
                                    <th>Notes</th>
                                </tr>
                            </thead>
                            <tbody>
                                {[
                                    { source: 'MindBody', refresh: '4-hour cache', quota: '5,000 calls/month', notes: 'Postgres backfill enables unlimited lookback at zero API cost' },
                                    { source: 'GoHighLevel v1', refresh: '15-min cache', quota: '200K calls/day', notes: 'Pipeline data, contacts, opportunities' },
                                    { source: 'GoHighLevel v2', refresh: '30-min cache', quota: '600 req/min', notes: 'Conversations, transcripts, DND checks' },
                                    { source: 'Meta Graph API', refresh: 'On page load (4-hr cache)', quota: 'Rate-limited per token', notes: 'Permanent page token for FB + IG organic' },
                                    { source: 'Meta Marketing API', refresh: 'On page load', quota: 'Rate-limited', notes: 'User token expires ~60 days' },
                                    { source: 'YouTube Data API', refresh: 'On page load', quota: '10,000 units/day', notes: '~3 units per refresh' },
                                    { source: 'TikTok API v2', refresh: 'On page load', quota: '600 req/min', notes: 'Token auto-refreshes every 24h' },
                                    { source: 'Google Search Console', refresh: 'Daily cron sync', quota: 'Standard', notes: '2-3 day data delay from Google' },
                                    { source: 'Kie.ai', refresh: 'On demand', quota: 'Pay per generation', notes: 'Image URLs expire in 24h, re-uploaded to Blob' },
                                ].map(row => (
                                    <tr key={row.source}>
                                        <td style={{ fontWeight: 600 }}>{row.source}</td>
                                        <td>{row.refresh}</td>
                                        <td>{row.quota}</td>
                                        <td style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>{row.notes}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table></div>
                    </Section>

                    <Section title="Known Limitations">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {[
                                'Conversation analysis is capped at 150 contacts per run — contacts beyond that get timestamp-only classification',
                                'MindBody ReferredBy field is self-reported by clients and often inaccurate — don\'t rely on it for attribution',
                                'GHL pipeline stages are only ~80% accurate — conversation data is the source of truth for lead intent',
                                'Instagram daily metrics can only look back 30 days from today (API limitation)',
                                'TikTok API does not provide profile views, audience demographics, watch time, or follower growth time series',
                                'Facebook deprecated several page metrics in November 2025 — some historical comparisons may show gaps',
                                'Google Search Console data has a 2-3 day delay',
                                'Vercel function timeout is 60 seconds — large backfills use chunked resumable processing',
                            ].map((item, i) => (
                                <div key={i} style={{ padding: '10px 14px', background: 'rgba(248,113,113,0.04)', border: '1px solid rgba(248,113,113,0.1)', borderRadius: '8px', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                                    {item}
                                </div>
                            ))}
                        </div>
                    </Section>
                </>
            )}
        </>
    );
}
