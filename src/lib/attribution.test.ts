import { describe, it, expect } from 'vitest';
import { resolveChannel } from './attribution';

describe('resolveChannel', () => {
    it('maps a Meta source label to Paid Social when attribution has not been fetched yet', () => {
        expect(resolveChannel('Facebook', null)).toBe('Paid Social');
        expect(resolveChannel('instagram', null)).toBe('Paid Social');
    });

    it('still lets native attribution win over the Meta source label', () => {
        expect(resolveChannel('Facebook', { sessionSource: 'Organic Search' })).toBe('Organic Search');
    });

    it('leaves an unlabeled contact with no attribution as Unattributed', () => {
        expect(resolveChannel(null, null)).toBe('Unattributed');
    });
});
