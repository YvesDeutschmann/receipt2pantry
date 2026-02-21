/**
 * Auth constants shared between web and native.
 * Ensures mobile testing uses the same default user as web.
 */

/** Default test user ID - must exist in Supabase auth and Test Household (run scripts/create_test_user_and_household.py) */
export const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000001'

/**
 * Get the current user ID (from localStorage with fallback to default)
 */
export function getUserId() {
  return localStorage.getItem('user_id') || DEFAULT_USER_ID
}
