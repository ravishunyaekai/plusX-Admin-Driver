-- =============================================================================
-- Live update SQL — all queries added/changed after Live Update 01-10-2026
-- Generated: 19-10-2026
-- Sources: queries_06_oct.sql, queries_15_oct.sql, queries_16_oct.sql,
--          queries_16_oct_resident_vehicle.sql
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1) coupon : backfill zero created_at  (06-10-2026)
--    created_at was stored as 0000-00-00 00:00:00 on insert
--    ⚠ Check live DB before running — take special care with this query
-- -----------------------------------------------------------------------------
UPDATE `plusx-node`.`coupon`
SET created_at = updated_at
WHERE created_at = '0000-00-00 00:00:00';


-- -----------------------------------------------------------------------------
-- 2) rsa_offline_booking : "Is booking completed?" Yes / No  (15-10-2026)
--    Yes : current flow (all fields required, rider auto-created).
--    No  : all fields optional; provide mobile_no and/or email_id (at least one).
--          No rider is created (linked if one already exists by mobile or email).
--    Existing rows default to 'Yes'.
-- -----------------------------------------------------------------------------
ALTER TABLE `plusx-node`.`rsa_offline_booking`
    ADD COLUMN is_booking_completed ENUM('Yes', 'No') NOT NULL DEFAULT 'Yes' AFTER rider_id;

ALTER TABLE `plusx-node`.`rsa_offline_booking`
    MODIFY COLUMN customer_name VARCHAR(150) NULL DEFAULT NULL,
    MODIFY COLUMN mobile_no     VARCHAR(20)  NULL DEFAULT NULL,
    MODIFY COLUMN email_id      VARCHAR(150) NULL DEFAULT NULL,
    MODIFY COLUMN address       TEXT         NULL;


-- -----------------------------------------------------------------------------
-- 3) rsa_offline_booking : nullable mobile_no fallback  (16-10-2026)
--    Run ONLY if you already applied an earlier version of (2) without mobile_no
--    being made nullable. Safe to skip if mobile_no is already NULL.
-- -----------------------------------------------------------------------------
-- ALTER TABLE `plusx-node`.`rsa_offline_booking`
--     MODIFY COLUMN mobile_no VARCHAR(20) NULL DEFAULT NULL;


-- -----------------------------------------------------------------------------
-- 4) community_resident : emirates (resident location)  (16-10-2026)
--    Used when adding a community resident along with vehicle details.
-- -----------------------------------------------------------------------------
ALTER TABLE `plusx-node`.`community_resident`
    ADD COLUMN emirates VARCHAR(100) NULL DEFAULT NULL AFTER address;
