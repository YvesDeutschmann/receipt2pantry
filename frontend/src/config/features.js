const isOn = (value) => value === '1' || value === 'true'

export const FEATURES = {
  // Deferred from MVP 2026-07-27; set VITE_FEATURE_MEAL_PLANNER=1 to re-enable.
  mealPlanner: isOn(import.meta.env.VITE_FEATURE_MEAL_PLANNER),
  // Deferred from MVP (OAuth-only beta); set VITE_FEATURE_EMAIL_AUTH=1 to re-enable email form.
  emailAuth: isOn(import.meta.env.VITE_FEATURE_EMAIL_AUTH),
}
