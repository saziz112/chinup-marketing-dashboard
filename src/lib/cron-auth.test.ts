import { describe, it, expect, afterEach } from 'vitest';
import { isCronAuthorized } from './cron-auth';

afterEach(() => { delete process.env.CRON_SECRET; });

it('unset secret never authorizes, even a missing header', () => {
    expect(isCronAuthorized(null)).toBe(false);
    expect(isCronAuthorized('Bearer undefined')).toBe(false);
});

it('matches only the exact bearer token', () => {
    process.env.CRON_SECRET = 'abc';
    expect(isCronAuthorized('Bearer abc')).toBe(true);
    expect(isCronAuthorized('Bearer abcd')).toBe(false);
});
