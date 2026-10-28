-- =============================================================================
-- rsa_offline_booking : Service Terms & Condition upload  (28-10-2026)
-- =============================================================================
-- Required when is_booking_completed = 'Yes', or booking status is Completed (PU).
-- Stored filename under uploads folder rsa-offline-proof.

ALTER TABLE `plusx-node`.`rsa_offline_booking`
    ADD COLUMN service_terms_condition VARCHAR(255) NULL DEFAULT NULL AFTER proof_of_transaction;
