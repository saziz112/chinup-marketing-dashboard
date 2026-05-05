import { describe, it, expect } from 'vitest';
import { checkDND, checkDNDSimple, normalizePhone, hashPhone, hashEmail } from '../dnd-check';

describe('checkDND', () => {
  it('returns true when no contact field is provided', () => {
    expect(checkDND({}, 'sms')).toBe(true);
    expect(checkDND({}, 'sms', undefined)).toBe(true);
    expect(checkDND({}, 'sms', '')).toBe(true);
  });

  it('returns false when contact is clear and has a phone', () => {
    expect(checkDND({}, 'sms', '+15551234567')).toBe(false);
  });

  it('returns true when native DND flag is set', () => {
    expect(checkDND({ dnd: true }, 'sms', '+15551234567')).toBe(true);
  });

  it('returns true when channel-specific DND is active', () => {
    expect(checkDND(
      { dndSettings: { SMS: { status: 'active' } } },
      'sms',
      '+15551234567',
    )).toBe(true);

    expect(checkDND(
      { dndSettings: { Email: { status: 'active' } } },
      'email',
      'test@example.com',
    )).toBe(true);
  });

  it('does not cross-block channels', () => {
    expect(checkDND(
      { dndSettings: { SMS: { status: 'active' } } },
      'email',
      'test@example.com',
    )).toBe(false);

    expect(checkDND(
      { dndSettings: { Email: { status: 'active' } } },
      'sms',
      '+15551234567',
    )).toBe(false);
  });

  it('returns true for DND-related tags', () => {
    expect(checkDND({ tags: ['DND'] }, 'sms', '+15551234567')).toBe(true);
    expect(checkDND({ tags: ['opted-out'] }, 'sms', '+15551234567')).toBe(true);
    expect(checkDND({ tags: ['unsubscribe'] }, 'sms', '+15551234567')).toBe(true);
    expect(checkDND({ tags: ['do not disturb'] }, 'sms', '+15551234567')).toBe(true);
    expect(checkDND({ tags: ['stop'] }, 'sms', '+15551234567')).toBe(true);
    expect(checkDND({ tags: ['blocked'] }, 'sms', '+15551234567')).toBe(true);
  });

  it('returns false for non-DND tags', () => {
    expect(checkDND({ tags: ['vip', 'returning'] }, 'sms', '+15551234567')).toBe(false);
  });
});

describe('checkDNDSimple', () => {
  it('delegates to checkDND correctly', () => {
    expect(checkDNDSimple(true, [], 'sms', '+15551234567')).toBe(true);
    expect(checkDNDSimple(false, ['DND'], 'sms', '+15551234567')).toBe(true);
    expect(checkDNDSimple(false, [], 'sms', '+15551234567')).toBe(false);
  });
});

describe('normalizePhone', () => {
  it('strips country code from 11-digit US number', () => {
    expect(normalizePhone('+15551234567')).toBe('5551234567');
    expect(normalizePhone('15551234567')).toBe('5551234567');
  });

  it('returns 10-digit numbers as-is', () => {
    expect(normalizePhone('5551234567')).toBe('5551234567');
  });

  it('strips formatting characters', () => {
    expect(normalizePhone('(555) 123-4567')).toBe('5551234567');
    expect(normalizePhone('555-123-4567')).toBe('5551234567');
    expect(normalizePhone('555 123 4567')).toBe('5551234567');
  });
});

describe('hashPhone', () => {
  it('produces consistent SHA-256 hashes', () => {
    const hash1 = hashPhone('+15551234567');
    const hash2 = hashPhone('(555) 123-4567');
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('hashEmail', () => {
  it('normalizes case and whitespace before hashing', () => {
    const hash1 = hashEmail('Test@Example.com');
    const hash2 = hashEmail('  test@example.com  ');
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });
});
