import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildB2cTokenEndpointFromIdToken } from '../costcoB2cConfig.js';
import { refreshCostcoTokensAppSide, isTerminalRefreshError } from '../costcoTokenRefresh.js';

vi.mock('@capacitor/core', () => ({
  CapacitorHttp: {
    post: vi.fn(),
  },
}));

const { CapacitorHttp } = await import('@capacitor/core');

function makeJwt(payload) {
  const header = btoa(JSON.stringify({ alg: 'none' }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.sig`;
}

describe('costcoTokenRefresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('buildB2cTokenEndpointFromIdToken uses tfp policy 209', () => {
    const idToken = makeJwt({
      iss: 'https://signin.costco.com/bfc5f2e2-aea6-44ef-abc2-f0c95c397145/v2.0',
      tfp: 'B2C_1A_SSO_WCS_signup_signin_209',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const endpoint = buildB2cTokenEndpointFromIdToken(idToken);
    expect(endpoint).toContain('b2c_1a_sso_wcs_signup_signin_209');
    expect(endpoint).not.toContain('signin_180');
  });

  it('refreshCostcoTokensAppSide returns new tokens on 200', async () => {
    const oldId = makeJwt({
      iss: 'https://signin.costco.com/bfc5f2e2-aea6-44ef-abc2-f0c95c397145/v2.0',
      tfp: 'B2C_1A_SSO_WCS_signup_signin_209',
      exp: Math.floor(Date.now() / 1000) - 60,
    });
    const newId = makeJwt({
      iss: 'https://signin.costco.com/bfc5f2e2-aea6-44ef-abc2-f0c95c397145/v2.0',
      tfp: 'B2C_1A_SSO_WCS_signup_signin_209',
      exp: Math.floor(Date.now() / 1000) + 900,
    });
    CapacitorHttp.post.mockResolvedValue({
      status: 200,
      data: { id_token: newId, refresh_token: 'rotated-rt' },
    });

    const out = await refreshCostcoTokensAppSide({
      refreshToken: 'rt-old',
      idToken: oldId,
      refreshTokenClientId: 'client-1',
    });
    expect(out.idToken).toBe(newId);
    expect(out.refreshToken).toBe('rotated-rt');
  });

  it('isTerminalRefreshError detects invalid_grant and http 4xx', () => {
    expect(isTerminalRefreshError({ code: 'invalid_grant' })).toBe(true);
    expect(isTerminalRefreshError(new Error('Token refresh failed: interaction_required'))).toBe(true);
    expect(isTerminalRefreshError({ code: 'http_404', status: 404 })).toBe(true);
    expect(isTerminalRefreshError({ code: 'refresh_clock_skew' })).toBe(true);
    expect(isTerminalRefreshError({ code: 'http_500' })).toBe(false);
  });

  it('refreshCostcoTokensAppSide rejects clock-skew id_token', async () => {
    const oldId = makeJwt({
      iss: 'https://signin.costco.com/e0714dd4-784d-46d6-a278-3e29553483eb/v2.0',
      tfp: 'B2C_1A_SSO_WCS_signup_signin_209',
      exp: Math.floor(Date.now() / 1000) - 60,
    });
    const skewedId = makeJwt({
      iss: 'https://signin.costco.com/e0714dd4-784d-46d6-a278-3e29553483eb/v2.0',
      tfp: 'B2C_1A_SSO_WCS_signup_signin_209',
      exp: Math.floor(Date.now() / 1000) - 120,
    });
    CapacitorHttp.post.mockResolvedValue({
      status: 200,
      data: { id_token: skewedId, refresh_token: 'rotated-rt' },
    });
    await expect(
      refreshCostcoTokensAppSide({
        refreshToken: 'rt-old',
        idToken: oldId,
        refreshTokenClientId: 'client-1',
      })
    ).rejects.toMatchObject({ code: 'refresh_clock_skew' });
  });
});
