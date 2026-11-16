-- Online RSA: van selected at charging start (roadside_vans.pod_id + snapshot)

ALTER TABLE `plusx-node`.`road_assistance`
    ADD COLUMN `van_id` VARCHAR(25) NULL DEFAULT NULL AFTER `pod_id`;

ALTER TABLE `plusx-node`.`road_assistance`
    ADD COLUMN `van_data` JSON NULL DEFAULT NULL AFTER `van_id`;