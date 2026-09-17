-- RSA offline lead emirates + riders.added_from = 'Rsa Offline'
-- Run once on existing databases (skip statements if already applied).

ALTER TABLE rsa_offline_booking
    ADD COLUMN emirates VARCHAR(100) NULL DEFAULT NULL AFTER address;

-- Enough room for 'Rsa Offline' / 'CI Offline' (older VARCHAR(10) truncated values)
ALTER TABLE riders
    MODIFY COLUMN added_from VARCHAR(50) NULL DEFAULT NULL;

-- Migrate legacy RSA offline labels to 'Rsa Offline'
UPDATE riders
SET added_from = 'Rsa Offline'
WHERE added_from IN ('Admin Offline', 'Admin Offl');
