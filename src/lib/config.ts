/**
 * Marketing Dashboard Configuration
 * Platform accounts, user roles, and competitor settings.
 */

// --- User Roles ---
export type UserRole = 'admin' | 'marketing_manager';

export interface DashboardUser {
    id: string;
    displayName: string;
    email: string;
    role: UserRole;
}

export const USERS: DashboardUser[] = [
    {
        id: 'admin',
        displayName: 'Sam Aziz',
        email: 'sam.aziz@chinupaesthetics.com',
        role: 'admin',
    },
    {
        id: 'sharia-philadelphia',
        displayName: 'Sharia Philadelphia',
        email: 'sharia@chinupaesthetics.com',
        role: 'marketing_manager',
    },
];

export const ADMIN_EMAIL = 'sam.aziz@chinupaesthetics.com';

// --- Platform Accounts ---
export interface PlatformAccount {
    platform: string;
    handle: string;
    url: string;
}

export const PLATFORM_ACCOUNTS: PlatformAccount[] = [
    { platform: 'instagram', handle: 'chinupaesthetics', url: 'https://instagram.com/chinupaesthetics' },
    { platform: 'facebook', handle: 'chinupaesthetics', url: 'https://facebook.com/chinupaesthetics' },
    { platform: 'youtube', handle: '@chinupaesthetics1233', url: 'https://youtube.com/@chinupaesthetics1233' },
];

// --- Competitor Accounts ---
export interface CompetitorAccount {
    name: string;
    platforms: {
        platform: string;
        handle: string;
    }[];
}

// To be configured via Settings page
export const COMPETITORS: CompetitorAccount[] = [];

// --- Sidebar Navigation ---
export interface NavItem {
    id: string;
    label: string;
    href: string;
    icon: string; // SVG path or emoji placeholder
    adminOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
    { id: 'overview', label: 'Overview', href: '/', icon: 'home' },
    { id: 'organic', label: 'Organic', href: '/organic', icon: 'trending-up' },
    { id: 'ads', label: 'Paid Ads', href: '/ads', icon: 'dollar-sign' },
    { id: 'attribution', label: 'Leads & Pipeline', href: '/attribution', icon: 'git-branch' },
    { id: 'reputation', label: 'Reputation', href: '/reputation', icon: 'star' },
    { id: 'content', label: 'Content', href: '/content', icon: 'layout' },
    { id: 'publish', label: 'Publish', href: '/publish', icon: 'send' },
    { id: 'creatives', label: 'Creatives', href: '/creatives', icon: 'sparkles' },
    { id: 'settings', label: 'Settings', href: '/settings', icon: 'settings', adminOnly: true },
];
