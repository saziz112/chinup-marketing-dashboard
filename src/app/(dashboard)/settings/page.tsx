'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function SettingsPage() {
    const { data: session } = useSession();
    const router = useRouter();

    const user = session?.user as Record<string, unknown> | undefined;
    const isAdmin = user?.isAdmin === true;

    interface APIStats {
        apiName: string;
        displayName: string;
        totalCalls: number;
        cacheHits: number;
        cacheMisses: number;
        cacheHitRate: number;
        quotaLimit: number | null;
        quotaUsed: number;
        quotaUnit: string;
        quotaPeriod: string;
        lastRefresh: string | null;
        estimatedCost: string;
    }

    const [usage, setUsage] = useState<{ trackedSince: string; apis: APIStats[] } | null>(null);
    const [usageLoading, setUsageLoading] = useState(true);

    useEffect(() => {
        if (user && !isAdmin) {
            router.push('/');
        }
    }, [user, isAdmin, router]);

    useEffect(() => {
        if (!isAdmin) return;
        fetch('/api/usage')
            .then(r => r.json())
            .then(data => setUsage(data))
            .catch(() => { })
            .finally(() => setUsageLoading(false));
    }, [isAdmin]);

    if (!isAdmin) return null;

    const platforms = [
        { name: 'Instagram', connected: false },
        { name: 'Facebook', connected: false },
        { name: 'YouTube', connected: false },
        { name: 'Meta Ads', connected: false },
        { name: 'Google Ads', connected: false },
        { name: 'Google Business', connected: false },
        { name: 'Search Console', connected: false },
        { name: 'MindBody', connected: false },
        { name: 'Yelp', connected: false },
        { name: 'RealSelf', connected: false },
    ];

    return (
        <>
            <div className="page-header">
                <h1>Settings</h1>
                <p className="subtitle">Manage connected accounts, sync status, and users</p>
            </div>

            <div className="section-card">
                <h3>Connected Accounts</h3>
                <div className="data-table-wrapper"><table className="data-table">
                    <thead>
                        <tr>
                            <th>Platform</th>
                            <th>Status</th>
                            <th>Last Sync</th>
                        </tr>
                    </thead>
                    <tbody>
                        {platforms.map(p => (
                            <tr key={p.name}>
                                <td style={{ fontWeight: 600 }}>{p.name}</td>
                                <td>
                                    <span className={`badge ${p.connected ? 'success' : 'warning'}`}>
                                        {p.connected ? 'Connected' : 'Not connected'}
                                    </span>
                                </td>
                                <td style={{ color: 'var(--text-muted)' }}>Never</td>
                            </tr>
                        ))}
                    </tbody>
                </table></div>
            </div>

            <div className="section-card">
                <h3>Data Sync</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '16px' }}>
                    Data syncs automatically every day at 2:00 AM EST. You can also trigger a manual sync below.
                </p>
                <button className="login-btn" style={{ width: 'auto', padding: '10px 24px' }} disabled>
                    Sync Now (Coming Soon)
                </button>
            </div>

            <div className="section-card">
                <h3>API Usage</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '16px' }}>
                    Real-time API quota consumption and cache efficiency. All integrations are on free tiers.
                </p>

                {usageLoading ? (
                    <p style={{ color: 'var(--text-muted)' }}>Loading...</p>
                ) : usage ? (
                    <>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
                            {usage.apis.map(api => (
                                <div key={api.apiName} className="metric-card" style={{ padding: '20px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                        <span style={{ fontWeight: 700, fontSize: '0.9375rem' }}>{api.displayName}</span>
                                        <span className="badge success">{api.estimatedCost}</span>
                                    </div>

                                    {api.quotaLimit ? (
                                        <div style={{ marginBottom: '16px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
                                                <span>{api.quotaUsed.toLocaleString()} / {api.quotaLimit.toLocaleString()} {api.quotaUnit}</span>
                                                <span>{Math.round((api.quotaUsed / api.quotaLimit) * 100)}%</span>
                                            </div>
                                            <div style={{ height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden' }}>
                                                <div style={{
                                                    height: '100%',
                                                    width: `${Math.min((api.quotaUsed / api.quotaLimit) * 100, 100)}%`,
                                                    background: (api.quotaUsed / api.quotaLimit) > 0.8 ? '#f59e0b' : '#22c55e',
                                                    borderRadius: '3px',
                                                    transition: 'width 0.3s',
                                                }} />
                                            </div>
                                            <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                                                per {api.quotaPeriod}
                                            </div>
                                        </div>
                                    ) : (
                                        <div style={{ marginBottom: '16px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                            {api.quotaUsed} {api.quotaUnit} today (no hard limit)
                                        </div>
                                    )}

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', fontSize: '0.75rem' }}>
                                        <div>
                                            <div style={{ color: 'var(--text-muted)', fontSize: '0.625rem', textTransform: 'uppercase', marginBottom: '2px' }}>API Calls</div>
                                            <div style={{ fontWeight: 700 }}>{api.totalCalls}</div>
                                        </div>
                                        <div>
                                            <div style={{ color: 'var(--text-muted)', fontSize: '0.625rem', textTransform: 'uppercase', marginBottom: '2px' }}>Cache Rate</div>
                                            <div style={{ fontWeight: 700, color: '#22c55e' }}>{api.cacheHitRate}%</div>
                                        </div>
                                        <div>
                                            <div style={{ color: 'var(--text-muted)', fontSize: '0.625rem', textTransform: 'uppercase', marginBottom: '2px' }}>Last Refresh</div>
                                            <div style={{ fontWeight: 600, fontSize: '0.6875rem' }}>
                                                {api.lastRefresh ? new Date(api.lastRefresh).toLocaleTimeString() : 'Never'}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.6875rem', marginTop: '12px' }}>
                            Tracking since {new Date(usage.trackedSince).toLocaleString()}. Stats reset on server restart.
                        </p>
                    </>
                ) : (
                    <p style={{ color: 'var(--text-muted)' }}>Unable to load usage data</p>
                )}
            </div>

            <div className="section-card">
                <h3>Users</h3>
                <div className="data-table-wrapper"><table className="data-table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Role</th>
                            <th>Email</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td style={{ fontWeight: 600 }}>Sam Aziz</td>
                            <td><span className="badge success">Admin</span></td>
                            <td>sam.aziz@chinupaesthetics.com</td>
                        </tr>
                        <tr>
                            <td style={{ fontWeight: 600 }}>Sharia Philadelphia</td>
                            <td><span className="badge info">Marketing Manager</span></td>
                            <td>sharia@chinupaesthetics.com</td>
                        </tr>
                    </tbody>
                </table></div>
            </div>
        </>
    );
}
