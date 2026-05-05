import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { getCached, setCache, clearCache } from '../cache';
import { promises as fs } from 'fs';
import path from 'path';

// Use a temp directory for tests
const TEST_CACHE_DIR = path.join(process.cwd(), '.cache-test');

// We need to mock the module-level CACHE_DIR constant
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return actual;
});

describe('cache', () => {
  beforeEach(async () => {
    // Clean up any existing cache files
    await clearCache();
  });

  afterEach(async () => {
    await clearCache();
  });

  it('returns null for a cache miss', async () => {
    const result = await getCached('nonexistent-key');
    expect(result).toBeNull();
  });

  it('stores and retrieves cached data', async () => {
    const data = { foo: 'bar', count: 42 };
    await setCache('test-key', data);
    const result = await getCached<typeof data>('test-key');
    expect(result).toEqual(data);
  });

  it('returns null for expired cache entries', async () => {
    // Set a cache entry
    await setCache('expire-test', { value: 1 });

    // Mock Date.now to simulate time passing (16 minutes > 15 min TTL)
    const realDateNow = Date.now;
    Date.now = () => realDateNow() + 16 * 60 * 1000;

    const result = await getCached('expire-test');
    expect(result).toBeNull();

    Date.now = realDateNow;
  });

  it('sanitizes cache keys to safe filenames', async () => {
    await setCache('unsafe/key:with!chars', { safe: true });
    const result = await getCached<{ safe: boolean }>('unsafe/key:with!chars');
    expect(result).toEqual({ safe: true });
  });
});
