/**
 * Simple file-based cache for API data.
 * Stores JSON in the filesystem to avoid hitting APIs on every page load.
 */

import { promises as fs } from 'fs';
import path from 'path';

const IS_VERCEL = process.env.VERCEL === '1';
const CACHE_DIR = IS_VERCEL
    ? path.join('/tmp', '.cache')
    : path.join(process.cwd(), '.cache');
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

interface CacheEntry<T> {
    data: T;
    timestamp: number;
    expiresAt: number;
}

async function ensureCacheDir() {
    try {
        await fs.mkdir(CACHE_DIR, { recursive: true });
    } catch {
        // directory exists
    }
}

function getCachePath(key: string): string {
    const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(CACHE_DIR, `${safeKey}.json`);
}

export async function getCached<T>(key: string): Promise<T | null> {
    try {
        const filePath = getCachePath(key);
        const raw = await fs.readFile(filePath, 'utf-8');
        const entry: CacheEntry<T> = JSON.parse(raw);

        if (Date.now() > entry.expiresAt) {
            await fs.unlink(filePath).catch(() => { });
            return null;
        }

        return entry.data;
    } catch {
        return null;
    }
}

export async function setCache<T>(key: string, data: T): Promise<void> {
    await ensureCacheDir();
    const entry: CacheEntry<T> = {
        data,
        timestamp: Date.now(),
        expiresAt: Date.now() + CACHE_TTL_MS,
    };
    const filePath = getCachePath(key);
    await fs.writeFile(filePath, JSON.stringify(entry), 'utf-8');
}

export async function clearCache(): Promise<void> {
    try {
        const files = await fs.readdir(CACHE_DIR);
        await Promise.all(files.map(f => fs.unlink(path.join(CACHE_DIR, f))));
    } catch {
        // nothing to clear
    }
}
