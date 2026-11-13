CREATE TABLE `plusx-node`.`roadside_vans` LIKE `pod_devices`;
CREATE TABLE `plusx-node`.`roadside_vans_battery` LIKE `pod_device_battery`;
 
ALTER TABLE `plusx-node`.`rsa_offline_booking` 
ADD COLUMN `van_id` VARCHAR(25) NULL AFTER `updated_at`;