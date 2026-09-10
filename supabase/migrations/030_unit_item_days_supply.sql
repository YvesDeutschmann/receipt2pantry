-- Backfill default_days_supply for UNIT_ITEM classifications (time-decay ceiling input).

UPDATE item_classification
SET default_days_supply = 60
WHERE depletion_class = 'UNIT_ITEM'
  AND default_days_supply IS NULL
  AND sub_class = 'grain_pasta';

UPDATE item_classification
SET default_days_supply = 180
WHERE depletion_class = 'UNIT_ITEM'
  AND default_days_supply IS NULL
  AND sub_class = 'canned_goods';
