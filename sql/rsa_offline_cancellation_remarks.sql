-- Offline RSA: cancellation remarks + cancelled_by when order_status = Cancelled (C)
ALTER TABLE rsa_offline_booking
    ADD COLUMN cancellation_remarks TEXT NULL AFTER booking_completed_date,
    ADD COLUMN cancelled_by VARCHAR(50) NULL AFTER cancellation_remarks;
