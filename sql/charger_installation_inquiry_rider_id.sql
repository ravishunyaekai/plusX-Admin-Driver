-- Link charger installation inquiries to app riders by mobile (same pattern as RSA offline)

ALTER TABLE charger_installation_inquiry
    ADD COLUMN rider_id VARCHAR(50) NULL DEFAULT NULL AFTER inquiry_id,
    ADD KEY idx_charger_installation_inquiry_rider_id (rider_id);

-- Optional backfill for existing inquiries where the mobile already has a rider account
UPDATE charger_installation_inquiry cii
INNER JOIN riders r ON r.rider_mobile = cii.mobile_no
SET cii.rider_id = r.rider_id
WHERE cii.rider_id IS NULL;
