-- Run on existing databases after rsa_offline_tables.sql

ALTER TABLE rsa_offline_booking
    ADD COLUMN country_code VARCHAR(10) NOT NULL DEFAULT '+971' AFTER email_id,
    ADD COLUMN mode_of_payment VARCHAR(50) NULL AFTER payment_status,
    ADD COLUMN rsa_id VARCHAR(50) NULL AFTER mode_of_payment,
    ADD COLUMN proof_of_transaction VARCHAR(255) NULL AFTER transaction_id,
    ADD KEY idx_rsa_offline_booking_rsa_id (rsa_id);

ALTER TABLE rsa_offline_order_history
    ADD COLUMN rsa_id VARCHAR(50) NULL AFTER driver_name,
    ADD KEY idx_rsa_offline_history_rsa_id (rsa_id);

-- Booking date fields sent from the admin form
ALTER TABLE rsa_offline_booking
    ADD COLUMN booking_date DATE NULL AFTER proof_of_transaction,
    ADD COLUMN booking_completed_date DATE NULL AFTER booking_date;
