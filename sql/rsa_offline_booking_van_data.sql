-- Offline RSA: snapshot of roadside_vans at completion (van_id, van_name, full row)

ALTER TABLE `rsa_offline_booking`
    ADD COLUMN `van_data` JSON NULL DEFAULT NULL AFTER `van_id`;