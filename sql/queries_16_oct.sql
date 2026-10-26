-- =============================================================================
-- rsa_offline_booking : allow empty mobile when booking is not completed (16-10-2026)
-- =============================================================================
-- Run this if you already applied queries_15_oct.sql before mobile_no was made nullable.
-- Safe to skip if mobile_no is already NULL.

ALTER TABLE `plusx-node`.`rsa_offline_booking`
    MODIFY COLUMN mobile_no VARCHAR(20) NULL DEFAULT NULL;
