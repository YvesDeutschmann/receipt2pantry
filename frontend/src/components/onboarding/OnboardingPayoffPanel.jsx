import ColdStartProgressBar from '../ColdStartProgressBar'

/**
 * Terminal onboarding step: "You're all set" + pulsing What's for Dinner CTA.
 * @param {object} props
 * @param {'owner' | 'joiner'} props.variant
 * @param {() => Promise<void>} props.onComplete
 * @param {boolean} props.submitting
 * @param {string | null} props.error
 */
export default function OnboardingPayoffPanel({
  variant = 'owner',
  onComplete,
  submitting = false,
  error = null,
}) {
  const bodyCopy =
    variant === 'joiner'
      ? "You're in — see what you can cook tonight."
      : 'Your pantry baseline is saved — see what you can cook tonight.'

  return (
    <div className="max-w-lg mx-auto w-full px-4 flex-1 flex flex-col pb-28">
      <ColdStartProgressBar highlightStep={3} step3Unlocked />

      <div className="mt-8 p-5 rounded-meald-lg border border-[var(--color-terra)]/35 bg-forest-light text-center">
        <p className="text-cream font-display font-semibold text-lg mb-2">
          You&apos;re all set
        </p>
        <p className="text-sage-light text-sm mb-6 leading-relaxed">{bodyCopy}</p>

        {error && (
          <p className="text-sm text-[var(--color-error)] mb-4">{error}</p>
        )}

        <button
          type="button"
          disabled={submitting}
          onClick={() => void onComplete()}
          className="w-full btn btn-primary animate-pulse disabled:opacity-50 disabled:cursor-not-allowed disabled:animate-none"
        >
          {submitting ? 'Opening…' : "What's for Dinner"}
        </button>
      </div>
    </div>
  )
}
