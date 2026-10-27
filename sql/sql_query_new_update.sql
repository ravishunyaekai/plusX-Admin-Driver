


-----------------------------------------------------------------------------
UPDATE `plusx-node`.`coupon`
SET created_at = updated_at
WHERE created_at = '0000-00-00 00:00:00';


-----------------------------------------------------------------------------
ALTER TABLE `plusx-node`.`rsa_offline_booking`
    ADD COLUMN is_booking_completed ENUM('Yes', 'No') NOT NULL DEFAULT 'Yes' AFTER rider_id;


ALTER TABLE `plusx-node`.`rsa_offline_booking`
    MODIFY COLUMN customer_name VARCHAR(150) NULL DEFAULT NULL,
    MODIFY COLUMN mobile_no     VARCHAR(20)  NULL DEFAULT NULL,
    MODIFY COLUMN email_id      VARCHAR(150) NULL DEFAULT NULL,
    MODIFY COLUMN address       TEXT         NULL;


----------------------------------------------------------------------------
ALTER TABLE `plusx-node`.`community_resident`
    ADD COLUMN emirates VARCHAR(100) NULL DEFAULT NULL AFTER address;

----------------------------------------------------------------------------

CREATE TABLE `plusx-node`.`terms_versions` (
    `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `module_name` VARCHAR(50) NOT NULL,
    `heading`     VARCHAR(500) NULL DEFAULT NULL,
    `content`     JSON NOT NULL,
    `version_no`  INT UNSIGNED NOT NULL,
    `status`      TINYINT NOT NULL DEFAULT 1,
    `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_terms_module_version` (`module_name`, `version_no`),
    KEY `idx_terms_module_status` (`module_name`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

----------------------------------------------------------------------------
SET SESSION group_concat_max_len = 1048576;

INSERT INTO `plusx-node`.`terms_versions` (`module_name`, `heading`, `content`, `version_no`, `status`, `created_at`)
SELECT
    c.module_name,
    m.heading,
    CONCAT('[', GROUP_CONCAT(JSON_QUOTE(c.content) ORDER BY c.id SEPARATOR ','), ']'),
    1,
    1,
    NOW()
FROM `plusx-node`.`response_content` c
LEFT JOIN `plusx-node`.`response_module` m
  ON m.name = c.module_name
 AND m.status = 1
 AND (m.sub_module IS NULL OR m.sub_module = '')
WHERE c.status = 1
  AND c.response_type IS NULL
  AND c.module_name IN ('portable-charger', 'pick-drop', 'road-assistance')
GROUP BY c.module_name, m.heading;


----------------------------------------------------------------------------
ALTER TABLE `plusx-node`.`portable_charger_booking`
    ADD COLUMN `terms_version_id` INT UNSIGNED NULL DEFAULT NULL,
    ADD COLUMN `terms_accepted_at` DATETIME NULL DEFAULT NULL,
    ADD KEY `idx_pcb_terms_version` (`terms_version_id`);

ALTER TABLE `plusx-node`.`charging_service`
    ADD COLUMN `terms_version_id` INT UNSIGNED NULL DEFAULT NULL,
    ADD COLUMN `terms_accepted_at` DATETIME NULL DEFAULT NULL,
    ADD KEY `idx_cs_terms_version` (`terms_version_id`);

ALTER TABLE `plusx-node`.`road_assistance`
    ADD COLUMN `terms_version_id` INT UNSIGNED NULL DEFAULT NULL,
    ADD COLUMN `terms_accepted_at` DATETIME NULL DEFAULT NULL,
    ADD KEY `idx_ra_terms_version` (`terms_version_id`);


----------------------------------------------------------------------------
UPDATE `plusx-node`.`portable_charger_booking` b
JOIN `plusx-node`.`terms_versions` t
  ON t.module_name = 'portable-charger'
 AND t.version_no = 1   
SET b.terms_version_id = t.id,
    b.terms_accepted_at = b.created_at
WHERE b.terms_version_id IS NULL;

UPDATE `plusx-node`.`charging_service` b
JOIN `plusx-node`.`terms_versions` t
  ON t.module_name = 'pick-drop'
 AND t.version_no = 1
SET b.terms_version_id = t.id,
    b.terms_accepted_at = b.created_at
WHERE b.terms_version_id IS NULL;

UPDATE `plusx-node`.`road_assistance` b
JOIN `plusx-node`.`terms_versions` t
  ON t.module_name = 'road-assistance'
 AND t.version_no = 1
SET b.terms_version_id = t.id,
    b.terms_accepted_at = b.created_at
WHERE b.terms_version_id IS NULL;



CREATE TABLE `vendor_list` (
  `id` int NOT NULL AUTO_INCREMENT,
  `vendor_id` varchar(22) NOT NULL,
  `vendor_name` varchar(50) NOT NULL,
  `area_name` varchar(55) NOT NULL,
  `showroom_name` varchar(55) NOT NULL,
  `emirate` varchar(25) NOT NULL,
  `address` varchar(150) NOT NULL,
  `package_price` float(10, 3) NOT NULL,
  `rsa_session` tinyint NOT NULL,
  `pod_session` tinyint NOT NULL,
  
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=0 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
 
 
CREATE TABLE `vendor_customers` (
    `id` int NOT NULL AUTO_INCREMENT,
    `customer_id` varchar(20) NOT NULL,
    `vendor_id` varchar(200) NOT NULL,
    `customer_name` varchar(100) NOT NULL,
    `country_code` varchar(10) NOT NULL DEFAULT '+971',
    `mobile_number` varchar(15) NOT NULL,
    `customer_email` varchar(85) NOT NULL,
    `showroom_name` varchar(100) NOT NULL,
    `emirate` varchar(50) NOT NULL,
    `ev_make` varchar(50) NOT NULL,
    `ev_model` varchar(80) NOT NULL,
    `purchase_date` date NOT NULL,
    `pod_charging_session_number` tinyint(4) DEFAULT 0,
    `pod_charging_session_validity` date DEFAULT NULL,
    `rsa_charging_session_number` tinyint(4) DEFAULT 0,
    `rsa_charging_session_validity` date DEFAULT NULL,
    `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
    `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=0 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
 
ALTER TABLE `plusx-node`.`vendor_customers` 
ADD COLUMN `package_data` JSON NULL AFTER `updated_at`;
 
ALTER TABLE `plusx-node`.`road_assistance` 
ADD COLUMN `package_data` JSON NULL ;
 
 
INSERT INTO `plusx-node`.`response_content` (`module_name`, `response_type`, `sub_module`, `content`, `status`) VALUES ('portable-charger-detail', 'info', 'package_cancel', 'Please Note: If you cancel this booking, your charging session will be credited back to your package and will be available for future bookings.', '1');
