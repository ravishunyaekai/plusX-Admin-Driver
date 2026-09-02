-- Portable Charger Charging Packages (Dubai)
-- Price is stored directly on each package row (sent from admin frontend).

CREATE TABLE IF NOT EXISTS `portable_charger_charging_packages` (
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

-- Optional: drop capacity config table if previously created (no longer used)
-- DROP TABLE IF EXISTS `portable_charger_capacity_prices`;

-- Link booking to selected package (run once if column does not exist)
-- ALTER TABLE `portable_charger_booking`
--   ADD COLUMN `package_id` varchar(20) NULL DEFAULT NULL AFTER `service_price`;
