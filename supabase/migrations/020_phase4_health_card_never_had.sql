-- Phase 4: health card cooldown on user_preferences; NEVER_HAD depletion reason

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS last_health_card_shown DATE;

COMMENT ON COLUMN user_preferences.last_health_card_shown IS
  'Date the low-confidence health card was last dismissed; 7-day cooldown.';

ALTER TABLE depletion_history DROP CONSTRAINT IF EXISTS depletion_history_reason_check;

ALTER TABLE depletion_history ADD CONSTRAINT depletion_history_reason_check
  CHECK (reason IN ('AUTO_EXPIRED', 'COOKED', 'USER_REMOVED', 'OVERRIDE', 'NEVER_HAD'));
