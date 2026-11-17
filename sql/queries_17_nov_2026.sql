-- EV RSA van assign (admin + driver flow) — after Live Update 13-11-2026
-- Excludes admin user / module access (see sql/admin_user_module_access.sql)
-- Offline `van_id` on rsa_offline_booking was added in sql/query_13_nov_2026.sql

-- Online RSA: admin-assigned van (roadside_vans.pod_id) + JSON snapshot at assign
ALTER TABLE `plusx-node`.`road_assistance`
    ADD COLUMN `van_id` VARCHAR(25) NULL DEFAULT NULL AFTER `pod_id`;

ALTER TABLE `plusx-node`.`road_assistance`
    ADD COLUMN `van_data` JSON NULL DEFAULT NULL AFTER `van_id`;

-- Offline RSA: full roadside_vans row snapshot at PU completion
ALTER TABLE `plusx-node`.`rsa_offline_booking`
    ADD COLUMN `van_data` JSON NULL DEFAULT NULL AFTER `van_id`;



-- user app - new user promo popup
INSERT INTO `response_content` (`module_name`, `response_type`, `content`, `status`)
SELECT 'home', 'new-user-welcome', '10% OFF Roadside Assistance!', 1
WHERE NOT EXISTS (
    SELECT 1 FROM `response_content`
    WHERE `module_name` = 'home' AND `response_type` = 'new-user-welcome'
      AND `content` = '10% OFF Roadside Assistance!'
);

INSERT INTO `response_content` (`module_name`, `response_type`, `content`, `status`)
SELECT 'home', 'new-user-welcome', 'Book Roadside Assistance & get 10% OFF with code RSA10%OFF.', 1
WHERE NOT EXISTS (
    SELECT 1 FROM `response_content`
    WHERE `module_name` = 'home' AND `response_type` = 'new-user-welcome'
      AND `content` = 'Book Roadside Assistance & get 10% OFF with code RSA10%OFF.'
);