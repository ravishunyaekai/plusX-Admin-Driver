-- Offline RSA: Lead Details for is_booking_completed = 'No' (02-11-2026)
-- reason_for_non_conversion required when order_status = 'NC' (Not Converted).

ALTER TABLE `plusx-node`.`rsa_offline_booking`
    ADD COLUMN reason_for_non_conversion VARCHAR(100) NULL DEFAULT NULL AFTER cancellation_remarks,
    ADD COLUMN lead_remarks TEXT NULL DEFAULT NULL AFTER reason_for_non_conversion,
    ADD KEY idx_rsa_offline_booking_non_conversion_reason (reason_for_non_conversion);
