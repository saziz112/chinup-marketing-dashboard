/**
 * Decide which watchlist accounts a refresh scrapes, and what it should cost.
 * Apify bills per result, so a run is capped and only touches stale accounts.
 */

import type { Platform } from './watchlist';

/**
 * Per-result list prices on Apify's free plan (checked 2026-10-19):
 * instagram-reel-scraper $2.60/1000; clockworks/tiktok-scraper "from $1.70/1000",
 * rounded up to $5/1000 because add-ons vary. YouTube goes through the free Data API.
 */
export const COST_PER_ITEM_USD: Record<Platform, number> = { instagram: 0.0026, tiktok: 0.005, youtube: 0 };
export const RUN_START_FEE_USD = 0.001;

export const STALE_AFTER_DAYS = 7;
export const MAX_ACCOUNTS_PER_RUN = 20;
export const VIDEOS_PER_ACCOUNT = 20;

export interface PlannableAccount {
    id: number;
    platform: Platform;
    handle: string;
    lastScrapedAt: string | null;
    active: boolean;
}

export interface RefreshPlan<T extends PlannableAccount> {
    accounts: T[];
    videosPerAccount: number;
    estCostUsd: number;
}

export function estimateCost(itemsByPlatform: Record<Platform, number>): number {
    let total = 0;
    for (const p of Object.keys(itemsByPlatform) as Platform[]) {
        const items = itemsByPlatform[p];
        if (items > 0 && COST_PER_ITEM_USD[p] > 0) total += items * COST_PER_ITEM_USD[p] + RUN_START_FEE_USD;
    }
    return Math.round(total * 1000) / 1000;
}

export function planRefresh<T extends PlannableAccount>(
    accounts: T[],
    now: Date,
    { maxAccounts = MAX_ACCOUNTS_PER_RUN, videosPerAccount = VIDEOS_PER_ACCOUNT, staleDays = STALE_AFTER_DAYS } = {},
): RefreshPlan<T> {
    const cutoff = now.getTime() - staleDays * 86_400_000;
    const time = (a: T) => (a.lastScrapedAt ? new Date(a.lastScrapedAt).getTime() : 0);
    const stale = accounts
        .filter(a => a.active && (!a.lastScrapedAt || time(a) < cutoff))
        .sort((a, b) => time(a) - time(b))
        .slice(0, maxAccounts);
    const items: Record<Platform, number> = { instagram: 0, tiktok: 0, youtube: 0 };
    for (const a of stale) items[a.platform] += videosPerAccount;
    return { accounts: stale, videosPerAccount, estCostUsd: estimateCost(items) };
}
