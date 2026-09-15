import { PRIVACY_URL, TERMS_URL } from '../config/legal'
import LegalLink from './LegalLink'

/** Shared auth footer: terms + privacy agreement line. */
export default function LegalAgreementNotice({ className = 'text-center text-sm text-sage-light mb-4' }) {
  return (
    <p className={className}>
      By continuing, you agree to our{' '}
      <LegalLink url={TERMS_URL}>Terms of Service</LegalLink>
      {' '}and{' '}
      <LegalLink url={PRIVACY_URL}>Privacy Policy</LegalLink>.
    </p>
  )
}
