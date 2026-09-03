CREATE TABLE IF NOT EXISTS `plusx-node`.`portable_charger_charging_packages` (
  `id` int NOT NULL AUTO_INCREMENT,
  `package_id` varchar(20) DEFAULT NULL,
  `package_name` varchar(100) NOT NULL,
  `charging_capacity` decimal(10,2) NOT NULL COMMENT 'kW',
  `price` decimal(10,2) NOT NULL DEFAULT 0.00 COMMENT 'Package price (AED)',
  `price_per_unit` decimal(10,2) NOT NULL DEFAULT 0.00 COMMENT 'Price per unit',
  `service_fee` decimal(10,2) NOT NULL DEFAULT 0.00,
  `order_id` varchar(100) DEFAULT NULL,
  `payment_id` varchar(100) DEFAULT NULL,
  `payment_status` enum('PENDING','SUCCESS','FAILED') DEFAULT 'PENDING',
  `payment_amount` decimal(10,2) DEFAULT '0.00',
  `coupon_code` varchar(50) DEFAULT NULL,
  `description` varchar(255) DEFAULT NULL,
  `status` tinyint(1) NOT NULL DEFAULT '1' COMMENT '1=Active, 0=Inactive',
  `is_deleted` tinyint(1) NOT NULL DEFAULT '0',
  `created_by` int DEFAULT NULL,
  `updated_by` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pccp_package_id` (`package_id`),
  KEY `idx_pccp_is_deleted_status` (`is_deleted`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;



----------

INSERT INTO `plusx-node`.`portable_charger_charging_packages` (
  package_id,
  package_name,
  charging_capacity,
  price,
  price_per_unit,
  service_fee,
  order_id,
  payment_id,
  payment_status,
  payment_amount,
  coupon_code,
  description,
  status,
  is_deleted,
  created_by,
  updated_by
) VALUES
  ('PKG-001', 'Package - 1', 30, 109.00, 0.00, 0.00, NULL, NULL, 'PENDING', 0.00, NULL, NULL, 1, 0, NULL, NULL),
  ('PKG-002', 'Package - 2', 50, 159.00, 0.00, 0.00, NULL, NULL, 'PENDING', 0.00, NULL, NULL, 1, 0, NULL, NULL);


-----------------------------------------------------------------------------------------------------


ALTER TABLE `plusx-node`.`portable_charger_booking`
ADD COLUMN `package_data` JSON NULL DEFAULT NULL
AFTER `booking_price`;


-----------------------------------------------------------------------------------------------------

ALTER TABLE `plusx-node`.`rsa_offline_booking`
    ADD COLUMN booking_date DATE NULL AFTER proof_of_transaction,
    ADD COLUMN booking_completed_date DATE NULL AFTER booking_date;


-----------------------------------------------------------------------------------------------------

UPDATE `plusx-node`.`response_content`
SET content = 'The 30 kW mobile charging service takes approximately 1 hour and 20 minutes to complete, while the 50 kW mobile charging service takes approximately 2 hours.'
WHERE content = 'The 30 kW mobile charging service takes approximately 1 hour and 20 minutes to complete.';

-----------------------------------------------------------------------------------------------------


-- portable-charger
UPDATE `plusx-node`.`response_module`
SET heading = 'Service Terms and Conditions:'
WHERE name = 'portable-charger'
  AND heading = 'Before booking, please note the following:';
 
-- road-assistance
UPDATE `plusx-node`.`response_module`
SET heading = 'Service Terms and Conditions:'
WHERE name = 'road-assistance'
  AND heading = 'Please Note :';
