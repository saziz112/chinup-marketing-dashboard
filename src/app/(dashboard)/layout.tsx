'use client';

import { useSession, signOut } from 'next-auth/react';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { NAV_ITEMS } from '@/lib/config';

// SVG icons for sidebar navigation
const ICONS: Record<string, React.ReactNode> = {
    home: (
        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
    ),
    'book-open': (
        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
        </svg>
    ),
    'trending-up': (
        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
            <polyline points="17 6 23 6 23 12" />
        </svg>
    ),
    'dollar-sign': (
        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="12" y1="1" x2="12" y2="23" />
            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        </svg>
    ),
    'git-branch': (
        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="6" y1="3" x2="6" y2="15" />
            <circle cx="18" cy="6" r="3" />
            <circle cx="6" cy="18" r="3" />
            <path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
    ),
    star: (
        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
    ),
    layout: (
        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <line x1="3" y1="9" x2="21" y2="9" />
            <line x1="9" y1="21" x2="9" y2="9" />
        </svg>
    ),
    send: (
        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
    ),
    sparkles: (
        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
            <path d="M5 19l1 3 1-3 3-1-3-1-1-3-1 3-3 1 3 1z" />
            <path d="M19 13l.75 2.25L22 16l-2.25.75L19 19l-.75-2.25L16 16l2.25-.75L19 13z" />
        </svg>
    ),
    search: (
        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
    ),
    settings: (
        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
    ),
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    const { data: session, status } = useSession();
    const router = useRouter();
    const pathname = usePathname();
    const [sidebarOpen, setSidebarOpen] = useState(false);

    useEffect(() => {
        if (status === 'unauthenticated') {
            router.push('/login');
        }
    }, [status, router]);

    if (status === 'loading') {
        return (
            <div className="loading-container">
                <div className="loading-spinner" />
                <p className="loading-text">Loading dashboard...</p>
            </div>
        );
    }

    if (!session) return null;

    const user = session.user as Record<string, unknown>;
    const isAdmin = user?.isAdmin === true;
    const displayName = (user?.name as string) || 'User';
    const role = isAdmin ? 'Admin' : 'Marketing Manager';
    const initials = displayName.split(' ').map(n => n[0]).join('').toUpperCase();

    const filteredNav = NAV_ITEMS.filter(item => !item.adminOnly || isAdmin);

    function isActive(href: string) {
        if (href === '/') return pathname === '/';
        return pathname.startsWith(href);
    }

    return (
        <>
            {/* Mobile Header */}
            <div className="mobile-header">
                <button className="hamburger-btn" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label={sidebarOpen ? 'Close navigation menu' : 'Open navigation menu'} aria-expanded={sidebarOpen}>
                    {sidebarOpen ? '\u2715' : '\u2630'}
                </button>
                <span style={{ fontFamily: 'var(--font-heading)', fontSize: '1.125rem', color: 'var(--text-secondary)' }}>
                    Chin Up!
                </span>
                <div className="user-avatar" style={{ width: 28, height: 28, fontSize: '0.625rem' }}>{initials}</div>
            </div>

            <div className="dashboard-layout">
                {/* Mobile Overlay */}
                {sidebarOpen && (
                    <div className="mobile-overlay" onClick={() => setSidebarOpen(false)} role="presentation" />
                )}

                {/* Sidebar */}
                <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`} role="navigation" aria-label="Main navigation">
                    <div className="sidebar-brand">
                        <div>
                            <h2>Chin Up!</h2>
                            <span>Marketing Dashboard</span>
                        </div>
                    </div>

                    <nav className="sidebar-nav" aria-label="Dashboard navigation">
                        {filteredNav.map((item, index) => {
                            const prevItem = index > 0 ? filteredNav[index - 1] : null;
                            const showGroupHeader = item.group && item.group !== prevItem?.group;

                            return (
                                <div key={item.id}>
                                    {showGroupHeader && (
                                        <div className="nav-group-header">{item.group}</div>
                                    )}
                                    <Link
                                        href={item.href}
                                        className={`nav-item ${isActive(item.href) ? 'active' : ''}`}
                                        onClick={() => setSidebarOpen(false)}
                                    >
                                        {ICONS[item.icon]}
                                        {item.label}
                                    </Link>
                                </div>
                            );
                        })}
                    </nav>

                    <div className="sidebar-footer">
                        <div className="user-info">
                            <div className="user-avatar">{initials}</div>
                            <div className="user-details">
                                <div className="name">{displayName}</div>
                                <div className="role">{role}</div>
                            </div>
                        </div>
                        <button className="sign-out-btn" onClick={() => signOut({ callbackUrl: '/login' })} aria-label="Sign out of dashboard">
                            Sign Out
                        </button>
                    </div>
                </aside>

                {/* Main Content */}
                <main className="main-content" role="main">
                    {children}
                </main>
            </div>
        </>
    );
}
