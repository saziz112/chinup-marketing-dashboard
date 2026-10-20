import { describe, it, expect } from 'vitest';
import { validateHook, parsePrice, countSyllables, gradeLevel, formatPrice } from './hooks';

const dysport = { treatment: 'Dysport', aliases: ['tox'], price: 650 };

describe('parsePrice', () => {
    it('reads dollars with or without $, commas and cents', () => {
        expect(parsePrice('$650')).toBe(650);
        expect(parsePrice('650')).toBe(650);
        expect(parsePrice('$1,300')).toBe(1300);
        expect(parsePrice('$2,113.20')).toBe(2113.2);
    });
    it('rejects anything that is not a positive price', () => {
        expect(parsePrice('')).toBeNull();
        expect(parsePrice('free')).toBeNull();
        expect(parsePrice('$0')).toBeNull();
        expect(parsePrice('20%')).toBeNull();
    });
});

describe('formatPrice', () => {
    it('drops .00 but keeps real cents', () => {
        expect(formatPrice(650)).toBe('$650');
        expect(formatPrice(1300)).toBe('$1,300');
        expect(formatPrice(2113.2)).toBe('$2,113.20');
    });
});

describe('countSyllables', () => {
    it('handles common words', () => {
        expect(countSyllables('face')).toBe(1);
        expect(countSyllables('the')).toBe(1);
        expect(countSyllables('lines')).toBe(1);
        expect(countSyllables('smoother')).toBe(2);
        expect(countSyllables('appointment')).toBe(3);
    });
});

describe('gradeLevel', () => {
    it('scores plain short sentences low and dense jargon high', () => {
        expect(gradeLevel('Get rid of the lines on your face. It takes ten minutes.')).toBeLessThan(5);
        expect(gradeLevel('Neuromodulator administration facilitates significant attenuation of dynamic periorbital rhytides.')).toBeGreaterThan(12);
    });
});

describe('validateHook', () => {
    it('passes a clear hook that names the treatment and the exact price', () => {
        const r = validateHook('Dysport is $650 for 60 units this month.', dysport);
        expect(r.ok).toBe(true);
        expect(r.problems).toEqual([]);
    });

    it('accepts an alias for the treatment and $ with commas', () => {
        const r = validateHook('Your tox, 125 units, just $1,300 this weekend.', { ...dysport, price: 1300 });
        expect(r.namesTreatment).toBe(true);
        expect(r.namesPrice).toBe(true);
    });

    it('fails a hook with no $ price', () => {
        const r = validateHook('Dysport smooths your frown lines fast.', dysport);
        expect(r.ok).toBe(false);
        expect(r.namesPrice).toBe(false);
        expect(r.problems.join(' ')).toMatch(/\$650/);
    });

    it('fails a hook whose price does not match the offer', () => {
        expect(validateHook('Dysport for $600 today.', dysport).namesPrice).toBe(false);
    });

    it('fails a clever hook that never names the treatment', () => {
        const r = validateHook('Your face called. It wants a vacation. $650.', dysport);
        expect(r.namesTreatment).toBe(false);
        expect(r.ok).toBe(false);
    });

    it('does not let a word that merely contains the treatment name count', () => {
        expect(validateHook('Dysporting is $650.', dysport).namesTreatment).toBe(false);
    });

    it('fails a hook above a 5th-grade reading level, ignoring the treatment name itself', () => {
        const hard = validateHook('Dysport, $650: sophisticated neuromodulation delivering comprehensive rejuvenation outcomes.', dysport);
        expect(hard.ok).toBe(false);
        expect(hard.problems.join(' ')).toMatch(/grade/);
        // Long brand names should not fail an otherwise plain hook.
        const brand = validateHook('SkinPen Microneedling is $1,274.40 for two visits.', { treatment: 'SkinPen Microneedling', price: 1274.4 });
        expect(brand.ok).toBe(true);
    });
});
