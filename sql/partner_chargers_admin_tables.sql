-- Partner Chargers Management — admin tables (stations + chargers)
-- IoT tables are out of scope for this migration.

CREATE TABLE IF NOT EXISTS partner_charging_stations (
    id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
    station_id         VARCHAR(50)  NOT NULL COMMENT 'Business id e.g. PLX-STA-001',
    station_name       VARCHAR(150) NOT NULL,
    station_type       VARCHAR(80)  NOT NULL,
    operator_name      VARCHAR(150) NOT NULL,
    address            TEXT         NOT NULL,
    city               VARCHAR(100) NOT NULL,
    state_emirate      VARCHAR(100) NOT NULL,
    country            VARCHAR(100) NOT NULL,
    postal_code        VARCHAR(30)  NULL DEFAULT NULL,
    latitude           DECIMAL(10, 6) NOT NULL,
    longitude          DECIMAL(10, 6) NOT NULL,
    contact_person     VARCHAR(150) NOT NULL,
    contact_number     VARCHAR(30)  NULL DEFAULT NULL,
    operating_hours    VARCHAR(80)  NOT NULL,
    admin_status       VARCHAR(40)  NOT NULL DEFAULT 'Active',
    description        TEXT         NOT NULL,
    number_of_chargers TINYINT UNSIGNED NOT NULL DEFAULT 1,
    master_email       VARCHAR(150) NOT NULL,
    master_password    VARCHAR(255) NOT NULL COMMENT 'bcrypt hash',
    status             TINYINT(1)   NOT NULL DEFAULT 1 COMMENT '1=active row, 0=soft deleted',
    created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_partner_station_id (station_id),
    UNIQUE KEY uq_partner_station_master_email (master_email),
    KEY idx_partner_station_city (city),
    KEY idx_partner_station_admin_status (admin_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS partner_chargers (
    id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
    charger_id           VARCHAR(50)  NOT NULL COMMENT 'Business id e.g. PLX-CHG-1001',
    charger_name         VARCHAR(150) NOT NULL,
    station_id           VARCHAR(50)  NOT NULL,
    manufacturer         VARCHAR(150) NOT NULL,
    model                VARCHAR(150) NOT NULL,
    serial_number        VARCHAR(100) NOT NULL,
    charger_type         VARCHAR(10)  NOT NULL COMMENT 'AC or DC',
    rated_power_kw       DECIMAL(8, 2) NOT NULL,
    connector_type       VARCHAR(50)  NOT NULL,
    connector_count      TINYINT UNSIGNED NOT NULL DEFAULT 1,
    input_supply         VARCHAR(80)  NOT NULL,
    max_output_voltage_v DECIMAL(8, 2) NOT NULL,
    installation_date    DATE         NOT NULL,
    sim_iccid            VARCHAR(30)  NULL DEFAULT NULL,
    imei                 VARCHAR(20)  NULL DEFAULT NULL,
    installation_notes   TEXT         NOT NULL,
    admin_status         VARCHAR(40)  NOT NULL DEFAULT 'Active',
    status               TINYINT(1)   NOT NULL DEFAULT 1 COMMENT '1=active row, 0=soft deleted',
    created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_partner_charger_id (charger_id),
    KEY idx_partner_chargers_station (station_id),
    KEY idx_partner_chargers_admin_status (admin_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `admin_modules` (`module_key`, `label`, `sort_order`)
SELECT 'partner_chargers', 'Partner Chargers Management', 15
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM `admin_modules` WHERE `module_key` = 'partner_chargers'
);

-- Existing deployments: align partner_chargers with Add Charger UI (run once if table already exists).
-- MySQL has no ADD COLUMN IF NOT EXISTS — ignore duplicate-column errors if re-run.
ALTER TABLE partner_chargers
    ADD COLUMN installation_date DATE NULL DEFAULT NULL AFTER max_output_voltage_v;
ALTER TABLE partner_chargers
    ADD COLUMN sim_iccid VARCHAR(30) NULL DEFAULT NULL AFTER installation_date;
ALTER TABLE partner_chargers
    ADD COLUMN imei VARCHAR(20) NULL DEFAULT NULL AFTER sim_iccid;
ALTER TABLE partner_chargers
    ADD COLUMN installation_notes TEXT NULL AFTER imei;

UPDATE partner_chargers
SET installation_date = COALESCE(installation_date, CURDATE()),
    installation_notes = COALESCE(NULLIF(TRIM(installation_notes), ''), '-'),
    manufacturer = COALESCE(NULLIF(TRIM(manufacturer), ''), '-'),
    model = COALESCE(NULLIF(TRIM(model), ''), '-'),
    serial_number = COALESCE(NULLIF(TRIM(serial_number), ''), '-'),
    input_supply = COALESCE(NULLIF(TRIM(input_supply), ''), 'Single Phase'),
    max_output_voltage_v = COALESCE(max_output_voltage_v, 0)
WHERE status = 1;

ALTER TABLE partner_chargers
    MODIFY COLUMN manufacturer         VARCHAR(150) NOT NULL,
    MODIFY COLUMN model                VARCHAR(150) NOT NULL,
    MODIFY COLUMN serial_number        VARCHAR(100) NOT NULL,
    MODIFY COLUMN input_supply         VARCHAR(80)  NOT NULL,
    MODIFY COLUMN max_output_voltage_v DECIMAL(8, 2) NOT NULL,
    MODIFY COLUMN installation_date    DATE         NOT NULL,
    MODIFY COLUMN installation_notes   TEXT         NOT NULL;