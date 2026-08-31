import { describe, expect, it } from 'vitest'
import {
  getCostcoDiagnosticSummary,
  recordCostcoDiagnosticEvent,
  resetCostcoDiagnosticStore,
  summarizeCostcoDiagnosticForDisplay,
} from '../costcoDiagnosticStore.js'

describe('costcoDiagnosticStore', () => {
  it('records checkpoints and token exchange', () => {
    resetCostcoDiagnosticStore('sync-1')
    recordCostcoDiagnosticEvent(
      'diag-checkpoint',
      { checkpoint: 'a0' },
      { censusSeen: 2, censusTfp: 'b2c_1a_test' }
    )
    recordCostcoDiagnosticEvent(
      'token-exchange',
      { fired: true, status: 200 },
      { tokenFired: true, tokenStatus: 200, tokenPolicy: 'b2c_1a_test' }
    )
    const summary = getCostcoDiagnosticSummary()
    expect(summary.checkpoints.a0?.flat?.censusSeen).toBe(2)
    expect(summary.tokenExchange?.flat?.tokenStatus).toBe(200)
    const pill = summarizeCostcoDiagnosticForDisplay(summary)
    expect(pill).toContain('A0 creds:2')
    expect(pill).toContain('/token 200')
  })

  it('shows missed sweeps and tfp from tokens-found', () => {
    resetCostcoDiagnosticStore('sync-2')
    recordCostcoDiagnosticEvent(
      'diag-checkpoint',
      { checkpoint: 'tokens-found' },
      { tfp: 'b2c_1a_sso_wcs_signup_signin_209' }
    )
    recordCostcoDiagnosticEvent(
      'token-exchange',
      { fired: false, source: 'missed', sweepRuns: 18 },
      { tokenFired: false, tokenSource: 'missed', tokenSweepRuns: 18 }
    )
    const pill = summarizeCostcoDiagnosticForDisplay(getCostcoDiagnosticSummary())
    expect(pill).toContain('/token missed (18 sweeps)')
    expect(pill).toContain('tfp:')
  })
})
