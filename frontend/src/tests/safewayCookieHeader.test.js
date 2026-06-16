import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildCookieHeader,
  COOKIE_HEADER_MAX_BYTES,
  cookieHeaderRetryTiers,
  isAllowedSafewayCookieKey,
  parseCookieHeader,
} from '../services/safewayCookieHeader';
import { fetchSafewayReceipts } from '../services/safewayApiFetcher';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => false,
  },
  CapacitorHttp: {
    request: vi.fn(),
  },
}));

describe('safewayCookieHeader', () => {
  it('SWY_SHARED_SESSION excluded from cookie header', () => {
    const header = buildCookieHeader({
      SWY_SHARED_SESSION: '{"accessToken":"' + 'x'.repeat(5000) + '"}',
      JSESSIONID: 'abc123',
    });
    expect(header).toBe('JSESSIONID=abc123');
    expect(header).not.toContain('SWY_SHARED_SESSION');
  });

  it('analytics cookies excluded', () => {
    const header = buildCookieHeader({
      _ga: 'GA1.1.123',
      reese84: 'bot-token',
      AMCV_123: 'adobe',
      OptanonConsent: 'consent',
      JSESSIONID: 'sess',
    });
    expect(header).toBe('JSESSIONID=sess');
  });

  it('WAF cookies retained', () => {
    const header = buildCookieHeader({
      JSESSIONID: 'js',
      incap_ses_123: 'incap',
      visid_incap_456: 'visid',
      nlbi_789: 'nlbi',
      'akacd_PR-foo': 'akamai',
    });
    expect(header).toContain('JSESSIONID=js');
    expect(header).toContain('incap_ses_123=incap');
    expect(header).toContain('visid_incap_456=visid');
  });

  it('header stays under budget when jar is bloated', () => {
    const cookies = { JSESSIONID: 'small' };
    for (let i = 0; i < 50; i++) {
      cookies[`ACI_S_extra_${i}`] = 'v'.repeat(200);
    }
    const header = buildCookieHeader(cookies);
    expect(header).toBeDefined();
    expect(header.length).toBeLessThanOrEqual(COOKIE_HEADER_MAX_BYTES);
  });

  it('waf-only tier excludes ACI_S cookies', () => {
    const header = buildCookieHeader(
      {
        ACI_S_abs_previouslogin: '{"clubCard":"123"}',
        incap_ses_1: 'x',
      },
      { tier: 'waf-only' }
    );
    expect(header).toBe('incap_ses_1=x');
    expect(isAllowedSafewayCookieKey('ACI_S_abs_previouslogin', 'waf-only')).toBe(false);
  });

  it('cookieHeaderRetryTiers produces full waf-only and token-only', () => {
    const full = buildCookieHeader({
      ACI_S_abs_previouslogin: 'small',
      incap_ses_1: 'waf',
    });
    const tiers = cookieHeaderRetryTiers(full);
    expect(tiers.map((t) => t.tier)).toEqual(['full', 'waf-only', 'token-only']);
    expect(tiers[1].cookieHeader).not.toContain('ACI_S_');
  });

  it('parseCookieHeader round-trips keys', () => {
    const parsed = parseCookieHeader('JSESSIONID=abc; incap_ses_1=def');
    expect(parsed).toEqual({ JSESSIONID: 'abc', incap_ses_1: 'def' });
  });
});

describe('fetchSafewayReceipts 431 retry', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn();
  });

  it('431 triggers slim retry then succeeds', async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock
      .mockResolvedValueOnce({
        status: 431,
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        status: 200,
        json: async () => ({ receipts: [{ transactionId: 't1', items: [] }] }),
      });

    const receipts = await fetchSafewayReceipts({
      accessToken: 'a'.repeat(20),
      clubCard: '1234567890',
      cookieHeader: 'ACI_S_abs_previouslogin=small; JSESSIONID=js',
      daysOverride: 90,
    });

    expect(receipts.length).toBeGreaterThanOrEqual(1);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });
});
