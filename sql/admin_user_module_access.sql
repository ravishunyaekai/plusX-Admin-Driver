-- Dubai admin: module catalogue + per-user grants (reference DDL — align with live DB)
--
-- `is_super_admin` on users = full panel; otherwise rows in `user_admin_modules` apply
-- (one user can have many modules).

ALTER TABLE `users`
  ADD COLUMN `is_super_admin` TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '1 = full panel access; 0 = limited via user_admin_modules'
  AFTER `department_id`;

CREATE TABLE IF NOT EXISTS `admin_modules` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `module_key` VARCHAR(50) NOT NULL,
  `label` VARCHAR(120) NOT NULL,
  `sort_order` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_admin_modules_module_key` (`module_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `admin_modules` (`module_key`, `label`, `sort_order`) VALUES
  ('dashboard', 'Dashboard', 1),
  ('app_signup', 'App Sign Up List', 2),
  ('drivers', 'Drivers', 3),
  ('portable_charger', 'Mobile & Portable EV Charging', 4),
  ('pick_drop', 'Pick & Drop', 5),
  ('ev_road_assistance', 'EV Road Assistance', 6),
  ('ev_insurance', 'EV Insurance', 7),
  ('public_chargers', 'Public Chargers Station', 8),
  ('charger_installation', 'Charger Installation', 9),
  ('community_charger', 'Community Charger', 10),
  ('vendor_charging', 'Vendor Charging Package', 11),
  ('charge_share', 'Charge Share Listings', 12),
  ('coupon', 'Coupon', 13),
  ('offer', 'Offer', 14)
ON DUPLICATE KEY UPDATE
  `label` = VALUES(`label`),
  `sort_order` = VALUES(`sort_order`);

CREATE TABLE IF NOT EXISTS `user_admin_modules` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `module_id` INT UNSIGNED NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_admin_modules_user_module` (`user_id`, `module_id`),
  KEY `idx_user_admin_modules_user_id` (`user_id`),
  KEY `idx_user_admin_modules_module_id` (`module_id`),
  CONSTRAINT `fk_user_admin_modules_module`
    FOREIGN KEY (`module_id`) REFERENCES `admin_modules` (`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
