-- WhatsApp send tracking per module (RSA offline + charger installation inquiry are independent)

ALTER TABLE rsa_offline_booking
    ADD COLUMN whatsapp_sent TINYINT(1) NOT NULL DEFAULT 0 AFTER booking_completed_date,
    ADD COLUMN whatsapp_campaign_id VARCHAR(50) NULL AFTER whatsapp_sent;

ALTER TABLE charger_installation_inquiry
    ADD COLUMN whatsapp_sent TINYINT(1) NOT NULL DEFAULT 0 AFTER lost_cancelled_remark,
    ADD COLUMN whatsapp_campaign_id VARCHAR(50) NULL AFTER whatsapp_sent;

-- Optional: drop shared log if it was created earlier
-- DROP TABLE IF EXISTS whatsapp_message_log;
