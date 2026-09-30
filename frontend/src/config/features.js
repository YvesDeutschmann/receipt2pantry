const isOn = (value) => value === '1' || value === 'true'

export const FEATURES = {
  // Deferred from MVP 2026-07-27; set VITE_FEATURE_MEAL_PLANNER=1 to re-enable.
  mealPlanner: isOn(import.meta.env.VITE_FEATURE_MEAL_PLANNER),
  // Store review / sign-in-only: VITE_FEATURE_EMAIL_SIGNIN=1 in .env.production.
  emailSignIn: isOn(import.meta.env.VITE_FEATURE_EMAIL_SIGNIN),
  // Full email sign-up (needs SMTP); VITE_FEATURE_EMAIL_AUTH=1.
  emailSignUp: isOn(import.meta.env.VITE_FEATURE_EMAIL_AUTH),
  /** @deprecated use emailSignIn / emailSignUp */
  emailAuth:
    isOn(import.meta.env.VITE_FEATURE_EMAIL_AUTH) ||
    isOn(import.meta.env.VITE_FEATURE_EMAIL_SIGNIN),
}
