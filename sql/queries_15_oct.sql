-- =============================================================================
-- rsa_offline_booking : "Is booking completed?" Yes / No  (15-10-2026)
-- =============================================================================
-- Yes : current flow (all fields required, rider auto-created).
-- No  : only mobile_no is required, no rider is created (linked if one already exists).
-- Existing rows default to 'Yes'.

ALTER TABLE `plusx-node`.`rsa_offline_booking`
    ADD COLUMN is_booking_completed ENUM('Yes', 'No') NOT NULL DEFAULT 'Yes' AFTER rider_id;

-- Fields that can be empty when is_booking_completed = 'No'
ALTER TABLE `plusx-node`.`rsa_offline_booking`
    MODIFY COLUMN customer_name VARCHAR(150) NULL DEFAULT NULL,
    MODIFY COLUMN email_id      VARCHAR(150) NULL DEFAULT NULL,
    MODIFY COLUMN address       TEXT         NULL;
