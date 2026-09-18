-- Charger installation inquiry: emirates (customer location)
-- Skip if column already exists.

ALTER TABLE charger_installation_inquiry
    ADD COLUMN emirates VARCHAR(100) NULL DEFAULT NULL AFTER email_id;
