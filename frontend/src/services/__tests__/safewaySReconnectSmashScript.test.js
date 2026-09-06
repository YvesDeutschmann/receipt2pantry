import { describe, it, expect } from 'vitest';
import { getSafewaySReconnectSmashScript } from '../safewaySReconnectSmashScript.js';

describe('safewaySReconnectSmashScript', () => {
  it('wipes known keys and posts silentUnrecoverable', () => {
    const code = getSafewaySReconnectSmashScript();
    expect(code).toContain('SWY_SHARED_SESSION');
    expect(code).toContain('okta-token-storage');
    expect(code).toContain('safeway-silent-unrecoverable');
    expect(code).toContain('s_reconnect_smash');
    expect(code).toContain('__safewaySkipHttpOnlyInject');
    expect(code).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
  });
});
