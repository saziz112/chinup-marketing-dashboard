import { describe, it, expect } from 'vitest';
import { createLatestRequest } from './latest-request';

describe('createLatestRequest', () => {
    it('lets only the most recent request write its result', () => {
        const latest = createLatestRequest();
        const thirtyDays = latest.start();
        const july = latest.start();
        expect(latest.isCurrent(july)).toBe(true);
        // The slower 30-day response lands after July's: it must be dropped.
        expect(latest.isCurrent(thirtyDays)).toBe(false);
    });
});
