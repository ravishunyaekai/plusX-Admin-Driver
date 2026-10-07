-- =============================================================================
-- coupon : created_at was stored as 0000-00-00 00:00:00 on insert
-- =============================================================================

-- Backfill existing rows that still have a zero created_at
UPDATE `plusx-node`.`coupon`
SET created_at = updated_at
WHERE created_at = '0000-00-00 00:00:00'; // check this in live db before going live , make special care for this query
