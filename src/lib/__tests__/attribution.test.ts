import { describe, it, expect } from 'vitest';
import { attributeSource, getPlatformLabel } from '../attribution';

describe('attributeSource', () => {
  it('returns "unknown" for null/undefined/empty input', () => {
    expect(attributeSource(null)).toBe('unknown');
    expect(attributeSource(undefined)).toBe('unknown');
    expect(attributeSource('')).toBe('unknown');
    expect(attributeSource('   ')).toBe('unknown');
  });

  it('returns "unknown" for date strings', () => {
    expect(attributeSource('2001-01-01T00:00:00.000Z')).toBe('unknown');
    expect(attributeSource('2024-06-15')).toBe('unknown');
  });

  describe('meta_ads attribution', () => {
    it('maps ad-related terms to meta_ads', () => {
      expect(attributeSource('Botox Ad')).toBe('meta_ads');
      expect(attributeSource('Filler Ad')).toBe('meta_ads');
      expect(attributeSource('Lip Ad')).toBe('meta_ads');
      expect(attributeSource('Tier3 Media')).toBe('meta_ads');
      expect(attributeSource('Facebook')).toBe('meta_ads');
      expect(attributeSource('FB')).toBe('meta_ads');
      expect(attributeSource('Meta')).toBe('meta_ads');
    });
  });

  describe('ig_organic attribution', () => {
    it('maps Instagram-related terms to ig_organic', () => {
      expect(attributeSource('Instagram')).toBe('ig_organic');
      expect(attributeSource('IG')).toBe('ig_organic');
      expect(attributeSource('Insta')).toBe('ig_organic');
    });
  });

  describe('google_organic attribution', () => {
    it('maps Google/web terms to google_organic', () => {
      expect(attributeSource('Google')).toBe('google_organic');
      expect(attributeSource('Google Search')).toBe('google_organic');
      expect(attributeSource('Website')).toBe('google_organic');
      expect(attributeSource('Online')).toBe('google_organic');
      expect(attributeSource('chinupaesthetics.com')).toBe('google_organic');
    });
  });

  describe('referral attribution', () => {
    it('maps referral terms to referral', () => {
      expect(attributeSource('Referral')).toBe('referral');
      expect(attributeSource('Friend')).toBe('referral');
      expect(attributeSource('Word of Mouth')).toBe('referral');
      expect(attributeSource('Yelp')).toBe('referral');
    });

    it('maps person names (with space) to referral', () => {
      expect(attributeSource('jane doe')).toBe('referral');
      expect(attributeSource('john smith')).toBe('referral');
    });
  });

  it('is case-insensitive', () => {
    expect(attributeSource('GOOGLE')).toBe('google_organic');
    expect(attributeSource('facebook')).toBe('meta_ads');
    expect(attributeSource('INSTAGRAM')).toBe('ig_organic');
  });

  it('returns "unknown" for unrecognized values', () => {
    expect(attributeSource('XYZ123')).toBe('unknown');
    expect(attributeSource('42')).toBe('unknown');
  });
});

describe('getPlatformLabel', () => {
  it('returns correct labels for all platforms', () => {
    expect(getPlatformLabel('google_organic')).toBe('Google Organic');
    expect(getPlatformLabel('meta_ads')).toBe('Meta Ads');
    expect(getPlatformLabel('ig_organic')).toBe('IG Organic');
    expect(getPlatformLabel('referral')).toBe('Referrals / Word of Mouth');
    expect(getPlatformLabel('unknown')).toBe('Unknown');
  });
});
