-- =============================================================================
-- rsa_offline_booking : "Is booking completed?" Yes / No  (15-10-2026)
-- =============================================================================
-- Yes : current flow (all fields required, rider auto-created).
-- No  : all fields optional; provide mobile_no and/or email_id (at least one).
--       No rider is created (linked if one already exists by mobile or email).
-- Existing rows default to 'Yes'.

ALTER TABLE `plusx-node`.`rsa_offline_booking`
    ADD COLUMN is_booking_completed ENUM('Yes', 'No') NOT NULL DEFAULT 'Yes' AFTER rider_id;

-- Fields that can be empty when is_booking_completed = 'No'
ALTER TABLE `plusx-node`.`rsa_offline_booking`
    MODIFY COLUMN customer_name VARCHAR(150) NULL DEFAULT NULL,
    MODIFY COLUMN mobile_no     VARCHAR(20)  NULL DEFAULT NULL,
    MODIFY COLUMN email_id      VARCHAR(150) NULL DEFAULT NULL,
    MODIFY COLUMN address       TEXT         NULL;

-- If you already ran the earlier version of this file (without mobile_no), run only:
-- ALTER TABLE `plusx-node`.`rsa_offline_booking`
--     MODIFY COLUMN mobile_no VARCHAR(20) NULL DEFAULT NULL;
