import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import OnboardingPayoffPanel from './OnboardingPayoffPanel'

vi.mock('../ColdStartProgressBar', () => ({
  default: () => <div data-testid="cold-start-progress" />,
}))

describe('OnboardingPayoffPanel', () => {
  it('JOINER_PAYOFF_SKIPS_BASELINE_COPY', () => {
    render(
      <OnboardingPayoffPanel
        variant="joiner"
        onComplete={vi.fn()}
        submitting={false}
        error={null}
      />
    )

    expect(screen.getByText(/You're in — see what you can cook tonight/i)).toBeInTheDocument()
    expect(screen.queryByText(/pantry baseline/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /What's for Dinner/i })).toHaveClass('animate-pulse')
    expect(screen.queryByRole('button', { name: /^Back$/i })).not.toBeInTheDocument()
  })

  it('OWNER_PAYOFF_SHOWS_BASELINE_COPY', () => {
    render(
      <OnboardingPayoffPanel
        variant="owner"
        onComplete={vi.fn()}
        submitting={false}
        error={null}
      />
    )

    expect(
      screen.getByText(/Your pantry baseline is saved — see what you can cook tonight/i)
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /What's for Dinner/i })).toHaveClass('animate-pulse')
  })

  it('PAYOFF_CTA_CALLS_ON_COMPLETE', () => {
    const onComplete = vi.fn().mockResolvedValue(undefined)
    render(
      <OnboardingPayoffPanel variant="owner" onComplete={onComplete} submitting={false} error={null} />
    )

    fireEvent.click(screen.getByRole('button', { name: /What's for Dinner/i }))
    expect(onComplete).toHaveBeenCalledTimes(1)
  })
})
