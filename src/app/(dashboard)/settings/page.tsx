'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

interface UserRow {
    id: number;
    email: string;
    display_name: string | null;
    staff_id: string;
    role: string;
    last_login_at: string | null;
    is_active: boolean;
    created_at: string;
    failed_login_attempts: number;
}

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

export default function SettingsPage() {
    const { data: session, update: updateSession } = useSession();
    const router = useRouter();
    const user = session?.user as Record<string, unknown> | undefined;
    const isAdmin = user?.isAdmin === true;

    // --- State ---
    const [users, setUsers] = useState<UserRow[]>([]);
    const [usersLoading, setUsersLoading] = useState(true);
    const [usage, setUsage] = useState<{ trackedSince: string; apis: APIStats[] } | null>(null);
    const [usageLoading, setUsageLoading] = useState(true);
    const [showAddUser, setShowAddUser] = useState(false);
    const [addEmail, setAddEmail] = useState('');
    const [addStaffId, setAddStaffId] = useState('');
    const [addRole, setAddRole] = useState('marketing_manager');
    const [actionMsg, setActionMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
    const [processing, setProcessing] = useState<string | null>(null);

    // Change own password
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [pwMsg, setPwMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

    // --- Tab state ---
    const [activeTab, setActiveTab] = useState<'users' | 'accounts' | 'usage' | 'sync'>('users');

    // Data sync state
    const [syncStatus, setSyncStatus] = useState<any>(null);
    const [syncLoading, setSyncLoading] = useState(false);
    const [syncAction, setSyncAction] = useState<string | null>(null);
    const [syncProgress, setSyncProgress] = useState<string | null>(null);
    const syncStopRef = useRef(false);

    useEffect(() => {
        if (user && !isAdmin) {
            router.push('/');
        }
    }, [user, isAdmin, router]);

    // Fetch users
    useEffect(() => {
        if (!isAdmin) return;
        fetch('/api/admin/users')
            .then(r => r.json())
            .then(d => setUsers(d.users || []))
            .catch(() => { })
            .finally(() => setUsersLoading(false));
    }, [isAdmin]);

    // Fetch API usage
    useEffect(() => {
        if (!isAdmin) return;
        fetch('/api/usage')
            .then(r => r.json())
            .then(data => setUsage(data))
            .catch(() => { })
            .finally(() => setUsageLoading(false));
    }, [isAdmin]);

    if (!isAdmin) return null;

    const showFlash = (text: string, type: 'success' | 'error') => {
        setActionMsg({ text, type });
        setTimeout(() => setActionMsg(null), 4000);
    };

    const handleAddUser = async (e: React.FormEvent) => {
        e.preventDefault();
        setProcessing('add');
        try {
            const res = await fetch('/api/admin/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: addEmail, staff_id: addStaffId, role: addRole }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Failed to add user');
            showFlash(`User ${addEmail} added. Default password: chinup2026`, 'success');
            setAddEmail(''); setAddStaffId(''); setAddRole('marketing_manager'); setShowAddUser(false);
            // Refresh
            const r2 = await fetch('/api/admin/users');
            const d2 = await r2.json();
            setUsers(d2.users || []);
        } catch (e: any) {
            showFlash(e.message, 'error');
        } finally {
            setProcessing(null);
        }
    };

    const handleDeleteUser = async (id: number, email: string) => {
        if (!confirm(`Are you sure you want to delete ${email}? This cannot be undone.`)) return;
        setProcessing(`del-${id}`);
        try {
            const res = await fetch('/api/admin/users', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id }),
            });
            if (!res.ok) throw new Error('Failed to delete');
            showFlash(`${email} has been removed.`, 'success');
            setUsers(prev => prev.filter(u => u.id !== id));
        } catch (e: any) {
            showFlash(e.message, 'error');
        } finally {
            setProcessing(null);
        }
    };

    const handleResetPassword = async (id: number, email: string) => {
        if (!confirm(`Reset password for ${email}? New password will be: chinup2026`)) return;
        setProcessing(`reset-${id}`);
        try {
            const res = await fetch('/api/admin/users', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, action: 'reset_password' }),
            });
            if (!res.ok) throw new Error('Failed to reset password');
            showFlash(`Password for ${email} reset to: chinup2026`, 'success');
        } catch (e: any) {
            showFlash(e.message, 'error');
        } finally {
            setProcessing(null);
        }
    };

    const handleChangeOwnPassword = async (e: React.FormEvent) => {
        e.preventDefault();
        if (newPassword !== confirmPassword) {
            setPwMsg({ text: 'Passwords do not match', type: 'error' });
            return;
        }
        if (newPassword.length < 6) {
            setPwMsg({ text: 'Password must be at least 6 characters', type: 'error' });
            return;
        }
        setProcessing('pw');
        try {
            const res = await fetch('/api/auth/change-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ currentPassword, newPassword }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to change password');
            setPwMsg({ text: 'Password updated successfully!', type: 'success' });
            setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
            if (updateSession) await updateSession();
        } catch (e: any) {
            setPwMsg({ text: e.message, type: 'error' });
        } finally {
            setProcessing(null);
        }
    };

    const formatDate = (d: string | null) => {
        if (!d) return 'Never';
        return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    };

    const loginStatus = (u: UserRow) => {
        if (!u.last_login_at) return { label: 'Never logged in', color: 'var(--text-muted)' };
        const diff = Date.now() - new Date(u.last_login_at).getTime();
        if (diff < 24 * 60 * 60 * 1000) return { label: 'Active today', color: '#22c55e' };
        if (diff < 7 * 24 * 60 * 60 * 1000) return { label: 'Active this week', color: '#22c55e' };
        if (diff < 30 * 24 * 60 * 60 * 1000) return { label: 'Active this month', color: '#f59e0b' };
        return { label: 'Inactive', color: '#ef4444' };
    };

    // Fetch sync status
    const fetchSyncStatus = async () => {
        setSyncLoading(true);
        try {
            const res = await fetch('/api/admin/data-sync');
            if (res.ok) setSyncStatus(await res.json());
        } catch { /* non-critical */ }
        finally { setSyncLoading(false); }
    };

    // Trigger a sync action (auto-loops for chunked backfills)
    const MAX_SYNC_LOOPS = 200; // Safety cap — 200 chunks × 3 months = 50 years max
    const triggerSync = async (action: string) => {
        setSyncAction(action);
        setSyncProgress(null);
        syncStopRef.current = false;
        let loops = 0;
        try {
            while (true) {
                loops++;
                // User clicked Stop
                if (syncStopRef.current) {
                    showFlash(`Stopped after ${loops - 1} steps. Progress is saved — you can resume later.`, 'success');
                    break;
                }
                // Safety cap
                if (loops > MAX_SYNC_LOOPS) {
                    showFlash(`Safety limit reached (${MAX_SYNC_LOOPS} iterations). Progress saved — resume to continue.`, 'error');
                    break;
                }
                const res = await fetch('/api/admin/data-sync', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Sync failed');

                // Show progress for chunked backfills
                if (data.chunkLabel) {
                    setSyncProgress(`Step ${loops}: ${data.chunkLabel} (${data.total || 0} records)`);
                }

                // If not a chunked response or done, break
                if (!data.continue) {
                    showFlash(`${action} complete! ${data.chunkLabel || `${loops} steps`}`, 'success');
                    break;
                }
            }
            fetchSyncStatus();
        } catch (e: any) {
            showFlash(e.message || 'Sync failed', 'error');
        } finally {
            setSyncAction(null);
            setSyncProgress(null);
            syncStopRef.current = false;
        }
    };

    const tabs = [
        { id: 'users' as const, label: 'Users & Security', icon: '👥' },
        { id: 'accounts' as const, label: 'Connected Accounts', icon: '🔗' },
        { id: 'usage' as const, label: 'API Usage', icon: '📊' },
        { id: 'sync' as const, label: 'Data Sync', icon: '🔄' },
    ];

    const platforms = [
        { name: 'MindBody', connected: true },
        { name: 'Instagram', connected: true },
        { name: 'Facebook', connected: true },
        { name: 'YouTube', connected: true },
        { name: 'Meta Ads', connected: true },
        { name: 'Google Ads', connected: true },
        { name: 'Google Business', connected: true },
        { name: 'Search Console', connected: true },
    ];

    return (
        <>
            <div className="page-header">
                <h1>Settings</h1>
                <p className="subtitle">Manage users, connected accounts, and API usage</p>
            </div>

            {/* Flash Message */}
            {actionMsg && (
                <div style={{
                    padding: '12px 20px',
                    borderRadius: '8px',
                    marginBottom: '16px',
                    background: actionMsg.type === 'success' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                    border: `1px solid ${actionMsg.type === 'success' ? '#22c55e' : '#ef4444'}`,
                    color: actionMsg.type === 'success' ? '#22c55e' : '#ef4444',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                }}>
                    {actionMsg.text}
                </div>
            )}

            {/* Tab Navigation */}
            <div style={{ display: 'flex', gap: '4px', marginBottom: '24px', background: 'rgba(255,255,255,0.03)', borderRadius: '10px', padding: '4px' }}>
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        style={{
                            flex: 1,
                            padding: '10px 16px',
                            borderRadius: '8px',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: '0.875rem',
                            fontWeight: activeTab === tab.id ? 600 : 400,
                            background: activeTab === tab.id ? 'rgba(255,255,255,0.08)' : 'transparent',
                            color: activeTab === tab.id ? '#fff' : 'var(--text-muted)',
                            transition: 'all 0.2s',
                        }}
                    >
                        {tab.icon} {tab.label}
                    </button>
                ))}
            </div>

            {/* ==================== USERS TAB ==================== */}
            {activeTab === 'users' && (
                <>
                    {/* User Management */}
                    <div className="section-card">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                            <h3 style={{ margin: 0 }}>User Management</h3>
                            <button
                                onClick={() => setShowAddUser(!showAddUser)}
                                className="login-btn"
                                style={{ width: 'auto', padding: '8px 20px', fontSize: '0.8125rem' }}
                            >
                                {showAddUser ? '✕ Cancel' : '+ Add User'}
                            </button>
                        </div>

                        {/* Add User Form */}
                        {showAddUser && (
                            <form onSubmit={handleAddUser} style={{
                                background: 'rgba(255,255,255,0.03)',
                                border: '1px solid var(--border-color)',
                                borderRadius: '10px',
                                padding: '20px',
                                marginBottom: '20px',
                                display: 'grid',
                                gridTemplateColumns: '1fr 1fr 1fr auto',
                                gap: '12px',
                                alignItems: 'end',
                            }}>
                                <div>
                                    <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Email Address</label>
                                    <input
                                        type="email"
                                        value={addEmail}
                                        onChange={e => setAddEmail(e.target.value)}
                                        placeholder="name@chinupaesthetics.com"
                                        required
                                        style={{
                                            width: '100%', padding: '8px 12px', borderRadius: '6px',
                                            border: '1px solid var(--border-color)', background: 'var(--card-bg)',
                                            color: '#fff', fontSize: '0.875rem', outline: 'none',
                                        }}
                                    />
                                </div>
                                <div>
                                    <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Staff ID</label>
                                    <input
                                        type="text"
                                        value={addStaffId}
                                        onChange={e => setAddStaffId(e.target.value)}
                                        placeholder="e.g. 100000123"
                                        required
                                        style={{
                                            width: '100%', padding: '8px 12px', borderRadius: '6px',
                                            border: '1px solid var(--border-color)', background: 'var(--card-bg)',
                                            color: '#fff', fontSize: '0.875rem', outline: 'none',
                                        }}
                                    />
                                </div>
                                <div>
                                    <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Role</label>
                                    <select
                                        value={addRole}
                                        onChange={e => setAddRole(e.target.value)}
                                        style={{
                                            width: '100%', padding: '8px 12px', borderRadius: '6px',
                                            border: '1px solid var(--border-color)', background: 'var(--card-bg)',
                                            color: '#fff', fontSize: '0.875rem', outline: 'none',
                                        }}
                                    >
                                        <option value="admin">Admin</option>
                                        <option value="marketing_manager">Marketing Manager</option>
                                    </select>
                                </div>
                                <button
                                    type="submit"
                                    disabled={processing === 'add'}
                                    className="login-btn"
                                    style={{ width: 'auto', padding: '8px 20px', fontSize: '0.8125rem', whiteSpace: 'nowrap' }}
                                >
                                    {processing === 'add' ? 'Adding...' : 'Add User'}
                                </button>
                            </form>
                        )}

                        {/* Users Table */}
                        {usersLoading ? (
                            <p style={{ color: 'var(--text-muted)' }}>Loading users...</p>
                        ) : (
                            <div className="data-table-wrapper">
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>User</th>
                                            <th>Role</th>
                                            <th>Last Login</th>
                                            <th>Status</th>
                                            <th style={{ textAlign: 'right' }}>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {users.map(u => {
                                            const status = loginStatus(u);
                                            const isSelf = (user?.staffId as string) === u.staff_id;
                                            return (
                                                <tr key={u.id}>
                                                    <td>
                                                        <div style={{ fontWeight: 600 }}>
                                                            {u.display_name || u.email}
                                                            {isSelf && <span style={{ marginLeft: '8px', fontSize: '0.6875rem', color: 'var(--accent)', fontWeight: 700 }}>YOU</span>}
                                                        </div>
                                                        {u.display_name && (
                                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{u.email}</div>
                                                        )}
                                                    </td>
                                                    <td>
                                                        <span className={`badge ${u.role === 'admin' ? 'success' : 'info'}`}>
                                                            {u.role === 'admin' ? 'Admin' : 'Marketing Manager'}
                                                        </span>
                                                    </td>
                                                    <td style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
                                                        {formatDate(u.last_login_at)}
                                                    </td>
                                                    <td>
                                                        <span style={{ color: status.color, fontSize: '0.8125rem', fontWeight: 500 }}>
                                                            ● {status.label}
                                                        </span>
                                                    </td>
                                                    <td style={{ textAlign: 'right' }}>
                                                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                                                            <button
                                                                onClick={() => handleResetPassword(u.id, u.email)}
                                                                disabled={processing === `reset-${u.id}`}
                                                                style={{
                                                                    padding: '4px 10px', borderRadius: '4px', fontSize: '0.75rem',
                                                                    background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border-color)',
                                                                    color: '#f59e0b', cursor: 'pointer',
                                                                }}
                                                            >
                                                                {processing === `reset-${u.id}` ? '...' : 'Reset PW'}
                                                            </button>
                                                            {!isSelf && (
                                                                <button
                                                                    onClick={() => handleDeleteUser(u.id, u.email)}
                                                                    disabled={processing === `del-${u.id}`}
                                                                    style={{
                                                                        padding: '4px 10px', borderRadius: '4px', fontSize: '0.75rem',
                                                                        background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
                                                                        color: '#ef4444', cursor: 'pointer',
                                                                    }}
                                                                >
                                                                    {processing === `del-${u.id}` ? '...' : 'Delete'}
                                                                </button>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    {/* Change Own Password */}
                    <div className="section-card">
                        <h3>Change Your Password</h3>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '16px' }}>
                            Update your own login password below.
                        </p>
                        {pwMsg && (
                            <div style={{
                                padding: '8px 16px', borderRadius: '6px', marginBottom: '12px',
                                background: pwMsg.type === 'success' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                                border: `1px solid ${pwMsg.type === 'success' ? '#22c55e' : '#ef4444'}`,
                                color: pwMsg.type === 'success' ? '#22c55e' : '#ef4444',
                                fontSize: '0.8125rem',
                            }}>
                                {pwMsg.text}
                            </div>
                        )}
                        <form onSubmit={handleChangeOwnPassword} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: '12px', alignItems: 'end' }}>
                            <div>
                                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Current Password</label>
                                <input
                                    type="password"
                                    value={currentPassword}
                                    onChange={e => setCurrentPassword(e.target.value)}
                                    required
                                    style={{
                                        width: '100%', padding: '8px 12px', borderRadius: '6px',
                                        border: '1px solid var(--border-color)', background: 'var(--card-bg)',
                                        color: '#fff', fontSize: '0.875rem', outline: 'none',
                                    }}
                                />
                            </div>
                            <div>
                                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>New Password</label>
                                <input
                                    type="password"
                                    value={newPassword}
                                    onChange={e => setNewPassword(e.target.value)}
                                    required
                                    minLength={6}
                                    style={{
                                        width: '100%', padding: '8px 12px', borderRadius: '6px',
                                        border: '1px solid var(--border-color)', background: 'var(--card-bg)',
                                        color: '#fff', fontSize: '0.875rem', outline: 'none',
                                    }}
                                />
                            </div>
                            <div>
                                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Confirm New Password</label>
                                <input
                                    type="password"
                                    value={confirmPassword}
                                    onChange={e => setConfirmPassword(e.target.value)}
                                    required
                                    style={{
                                        width: '100%', padding: '8px 12px', borderRadius: '6px',
                                        border: '1px solid var(--border-color)', background: 'var(--card-bg)',
                                        color: '#fff', fontSize: '0.875rem', outline: 'none',
                                    }}
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={processing === 'pw'}
                                className="login-btn"
                                style={{ width: 'auto', padding: '8px 20px', fontSize: '0.8125rem', whiteSpace: 'nowrap' }}
                            >
                                {processing === 'pw' ? 'Updating...' : 'Update Password'}
                            </button>
                        </form>
                    </div>
                </>
            )}

            {/* ==================== CONNECTED ACCOUNTS TAB ==================== */}
            {activeTab === 'accounts' && (
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
                                    <td style={{ color: 'var(--text-muted)' }}>
                                        {p.connected ? 'Auto-sync daily' : 'Never'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table></div>

                    <div style={{ marginTop: '20px' }}>
                        <h3>Data Sync</h3>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '16px' }}>
                            Data syncs automatically every day at 2:00 AM EST. You can also trigger a manual sync below.
                        </p>
                        <button className="login-btn" style={{ width: 'auto', padding: '10px 24px' }} disabled>
                            Sync Now (Coming Soon)
                        </button>
                    </div>
                </div>
            )}

            {/* ==================== DATA SYNC TAB ==================== */}
            {activeTab === 'sync' && (
                <div className="section-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                        <div>
                            <h3 style={{ margin: 0 }}>Data Sync</h3>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', marginTop: '4px' }}>
                                Sync MindBody &amp; GHL data to Postgres for unlimited lookback and advanced segmentation.
                            </p>
                        </div>
                        <button
                            onClick={fetchSyncStatus}
                            disabled={syncLoading}
                            style={{
                                padding: '8px 16px', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border-subtle)',
                                borderRadius: '8px', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.8125rem',
                            }}
                        >
                            {syncLoading ? 'Loading...' : 'Refresh Status'}
                        </button>
                    </div>

                    {!syncStatus && !syncLoading && (
                        <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                            Click &quot;Refresh Status&quot; to load sync data.
                        </div>
                    )}

                    {syncLoading && !syncStatus && (
                        <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>Loading...</div>
                    )}

                    {syncStatus && (
                        <>
                            {/* Status Cards */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '24px' }}>
                                {[
                                    { label: 'MB Sales', value: syncStatus.mindbody?.salesCount?.toLocaleString() || '0', sub: syncStatus.mindbody?.syncStates?.find((s: any) => s.syncType === 'sales')?.lastSyncDate || 'Never synced' },
                                    { label: 'MB Appointments', value: syncStatus.mindbody?.appointmentsCount?.toLocaleString() || '0', sub: syncStatus.mindbody?.syncStates?.find((s: any) => s.syncType === 'appointments')?.lastSyncDate || 'Never synced' },
                                    { label: 'MB Clients', value: syncStatus.mindbody?.clientsCount?.toLocaleString() || '0', sub: syncStatus.mindbody?.syncStates?.find((s: any) => s.syncType === 'clients')?.lastSyncDate || 'Never synced' },
                                    { label: 'GHL Contacts', value: syncStatus.ghl?.totalContacts?.toLocaleString() || '0', sub: syncStatus.ghl?.lastSync || 'Never synced' },
                                    { label: 'GHL w/ Phone', value: syncStatus.ghl?.withPhone?.toLocaleString() || '0', sub: `${syncStatus.ghl?.totalContacts ? Math.round((syncStatus.ghl.withPhone / syncStatus.ghl.totalContacts) * 100) : 0}% of total` },
                                    { label: 'GHL w/ Email', value: syncStatus.ghl?.withEmail?.toLocaleString() || '0', sub: `${syncStatus.ghl?.totalContacts ? Math.round((syncStatus.ghl.withEmail / syncStatus.ghl.totalContacts) * 100) : 0}% of total` },
                                ].map(stat => (
                                    <div key={stat.label} className="metric-card" style={{ padding: '16px' }}>
                                        <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>{stat.label}</div>
                                        <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{stat.value}</div>
                                        <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginTop: '2px' }}>{stat.sub}</div>
                                    </div>
                                ))}
                            </div>

                            {/* GHL by Location */}
                            {syncStatus.ghl?.byLocation && Object.keys(syncStatus.ghl.byLocation).length > 0 && (
                                <div style={{ marginBottom: '24px' }}>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '8px', fontWeight: 600 }}>GHL Contacts by Location</div>
                                    <div style={{ display: 'flex', gap: '16px', fontSize: '0.8125rem' }}>
                                        {Object.entries(syncStatus.ghl.byLocation).map(([loc, cnt]) => (
                                            <div key={loc}>
                                                <span style={{ color: 'var(--text-muted)', textTransform: 'capitalize' }}>{loc}: </span>
                                                <span style={{ fontWeight: 600 }}>{(cnt as number).toLocaleString()}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Progress indicator */}
                            {syncProgress && (
                                <div style={{
                                    padding: '12px 16px', marginBottom: '16px',
                                    background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.2)',
                                    borderRadius: '8px', fontSize: '0.8125rem', color: '#60A5FA',
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px',
                                }}>
                                    <span>{syncProgress}</span>
                                    <button
                                        onClick={() => { syncStopRef.current = true; }}
                                        style={{
                                            padding: '4px 14px', fontSize: '0.75rem', fontWeight: 600,
                                            background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)',
                                            borderRadius: '6px', color: '#EF4444', cursor: 'pointer', whiteSpace: 'nowrap',
                                        }}
                                    >
                                        Stop
                                    </button>
                                </div>
                            )}

                            {/* Action Buttons */}
                            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '20px' }}>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '12px', fontWeight: 600, textTransform: 'uppercase' }}>Backfill (One-Time)</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
                                    {[
                                        { action: 'backfill-mindbody', label: 'Backfill MindBody (All)', est: '~500 API calls' },
                                        { action: 'backfill-ghl', label: 'Backfill GHL Contacts', est: '~320 API calls' },
                                    ].map(btn => (
                                        <button
                                            key={btn.action}
                                            disabled={!!syncAction}
                                            onClick={() => { if (confirm(`Run ${btn.label}? This will use ${btn.est}.`)) triggerSync(btn.action); }}
                                            style={{
                                                padding: '8px 16px', fontSize: '0.8125rem', fontWeight: 500,
                                                background: 'rgba(216,180,29,0.1)', border: '1px solid rgba(216,180,29,0.3)',
                                                borderRadius: '8px', color: '#D8B41D', cursor: syncAction ? 'wait' : 'pointer',
                                                opacity: syncAction ? 0.6 : 1,
                                            }}
                                        >
                                            {syncAction === btn.action ? 'Running...' : btn.label}
                                        </button>
                                    ))}
                                </div>

                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '12px', fontWeight: 600, textTransform: 'uppercase' }}>Incremental Sync (Daily)</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                    {[
                                        { action: 'sync', label: 'Sync All (MB + GHL)', est: '~10 calls' },
                                        { action: 'sync-mindbody', label: 'Sync MindBody Only', est: '~5 calls' },
                                        { action: 'sync-ghl', label: 'Sync GHL Only', est: '~5 calls' },
                                    ].map(btn => (
                                        <button
                                            key={btn.action}
                                            disabled={!!syncAction}
                                            onClick={() => triggerSync(btn.action)}
                                            style={{
                                                padding: '8px 16px', fontSize: '0.8125rem', fontWeight: 500,
                                                background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)',
                                                borderRadius: '8px', color: '#22c55e', cursor: syncAction ? 'wait' : 'pointer',
                                                opacity: syncAction ? 0.6 : 1,
                                            }}
                                        >
                                            {syncAction === btn.action ? 'Running...' : btn.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* ==================== API USAGE TAB ==================== */}
            {activeTab === 'usage' && (
                <div className="section-card">
                    <h3>API Usage — {new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' })}</h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '16px' }}>
                        Monthly API call totals per platform. Persisted across deploys.
                    </p>

                    {usageLoading ? (
                        <p style={{ color: 'var(--text-muted)' }}>Loading...</p>
                    ) : usage ? (
                        <>
                            {/* Monthly summary bar */}
                            <div style={{
                                display: 'flex', gap: '20px', padding: '16px 20px', marginBottom: '20px',
                                background: 'rgba(216,180,29,0.06)', border: '1px solid rgba(216,180,29,0.15)', borderRadius: '10px',
                                flexWrap: 'wrap',
                            }}>
                                <div>
                                    <div style={{ fontSize: '0.625rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '2px' }}>Total Calls This Month</div>
                                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#D8B41D' }}>
                                        {usage.apis.reduce((sum: number, a: APIStats) => sum + a.totalCalls, 0).toLocaleString()}
                                    </div>
                                </div>
                                <div>
                                    <div style={{ fontSize: '0.625rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '2px' }}>Cache Hits</div>
                                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#22c55e' }}>
                                        {usage.apis.reduce((sum: number, a: APIStats) => sum + a.cacheHits, 0).toLocaleString()}
                                    </div>
                                </div>
                                <div>
                                    <div style={{ fontSize: '0.625rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '2px' }}>Avg Cache Rate</div>
                                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#22c55e' }}>
                                        {(() => {
                                            const total = usage.apis.reduce((s: number, a: APIStats) => s + a.totalCalls + a.cacheHits, 0);
                                            const hits = usage.apis.reduce((s: number, a: APIStats) => s + a.cacheHits, 0);
                                            return total > 0 ? Math.round((hits / total) * 100) : 0;
                                        })()}%
                                    </div>
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
                                {usage.apis.map((api: APIStats) => (
                                    <div key={api.apiName} className="metric-card" style={{ padding: '20px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                            <span style={{ fontWeight: 700, fontSize: '0.9375rem' }}>{api.displayName}</span>
                                        </div>

                                        {/* Monthly total — prominent */}
                                        <div style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '4px' }}>
                                            {api.totalCalls.toLocaleString()}
                                        </div>
                                        <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
                                            calls this month
                                        </div>

                                        {api.quotaLimit ? (
                                            <div style={{ marginBottom: '12px' }}>
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
                                                    quota per {api.quotaPeriod}
                                                </div>
                                            </div>
                                        ) : null}

                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.75rem' }}>
                                            <div>
                                                <div style={{ color: 'var(--text-muted)', fontSize: '0.625rem', textTransform: 'uppercase', marginBottom: '2px' }}>Cache Rate</div>
                                                <div style={{ fontWeight: 700, color: '#22c55e' }}>{api.cacheHitRate}%</div>
                                            </div>
                                            <div>
                                                <div style={{ color: 'var(--text-muted)', fontSize: '0.625rem', textTransform: 'uppercase', marginBottom: '2px' }}>Last Refresh</div>
                                                <div style={{ fontWeight: 600, fontSize: '0.6875rem' }}>
                                                    {api.lastRefresh ? new Date(api.lastRefresh).toLocaleTimeString() : '—'}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </>
                    ) : (
                        <p style={{ color: 'var(--text-muted)' }}>Unable to load usage data</p>
                    )}
                </div>
            )}
        </>
    );
}
