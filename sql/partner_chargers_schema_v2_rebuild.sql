-- =============================================================================
-- Partner Chargers Management — schema v2 (drop & recreate admin + customer tables)
-- =============================================================================
-- WARNING: Destroys all partner station/charger/customer rows and IoT history.
-- Run only on dev or after backup. IoT team must re-sync charger_id values.
--
--   mysql -u USER -p DATABASE < sql/partner_chargers_schema_v2_rebuild.sql
--
-- Admin UI mapping:
--   Station  → partner_charging_stations
--   Charger  → partner_chargers
--   Customer → partner_charger_customers + partner_customer_charger_map + partner_customer_vehicles
--   Sessions / telemetry (IoT) → partner_charger_session_history, partner_charger_data_history
-- =============================================================================

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS partner_customer_vehicles;
DROP TABLE IF EXISTS partner_customer_charger_map;
DROP TABLE IF EXISTS partner_charger_customers;
DROP TABLE IF EXISTS partner_charger_alerts;
DROP TABLE IF EXISTS partner_charger_session_history;
DROP TABLE IF EXISTS partner_charger_data_history;
DROP TABLE IF EXISTS partner_chargers;
DROP TABLE IF EXISTS partner_charging_stations;

SET FOREIGN_KEY_CHECKS = 1;

-- -----------------------------------------------------------------------------
-- partner_charging_stations — Add Station page
-- -----------------------------------------------------------------------------
CREATE TABLE partner_charging_stations (
    id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
    station_id         VARCHAR(50)  NOT NULL COMMENT 'Business id e.g. PLX-STA-001',
    station_name       VARCHAR(150) NOT NULL,
    station_type       VARCHAR(40)  NOT NULL COMMENT 'Public Station | Private Station',
    emirates           VARCHAR(100) NOT NULL,
    address            TEXT         NOT NULL,
    latitude           DECIMAL(10, 6) NOT NULL,
    longitude          DECIMAL(10, 6) NOT NULL,
    manager_name       VARCHAR(150) NOT NULL,
    manager_email      VARCHAR(150) NOT NULL COMMENT 'Station master portal login',
    country_code       VARCHAR(10)  NOT NULL DEFAULT '+971',
    manager_contact_no VARCHAR(30)  NULL DEFAULT NULL COMMENT 'Optional; local number without country code',
    manager_password   VARCHAR(255) NOT NULL COMMENT 'bcrypt hash',
    operating_hours    TEXT         NOT NULL COMMENT 'JSON: always_open + schedule { monday: { open, close, closed }, ... }',
    station_status     VARCHAR(40)  NOT NULL DEFAULT 'Active' COMMENT 'Active | Inactive | Under Maintenance',
    status             TINYINT(1)   NOT NULL DEFAULT 1 COMMENT '1=active row, 0=soft deleted',
    created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_partner_station_id (station_id),
    UNIQUE KEY uq_partner_station_manager_email (manager_email),
    KEY idx_partner_station_emirates (emirates),
    KEY idx_partner_station_status (station_status),
    KEY idx_partner_station_type (station_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- partner_chargers — Add Charger page
-- -----------------------------------------------------------------------------
CREATE TABLE partner_chargers (
    id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
    charger_id           VARCHAR(50)  NOT NULL COMMENT 'Business id e.g. PLX-CHG-1001',
    station_id           VARCHAR(50)  NOT NULL,
    rated_power_kw       DECIMAL(8, 2) NOT NULL,
    charging_type        VARCHAR(10)  NOT NULL DEFAULT 'Free' COMMENT 'Free | Paid',
    unit_price_aed       DECIMAL(10, 4) NULL DEFAULT NULL COMMENT 'Required when charging_type = Paid',
    charging_mode        VARCHAR(20)  NOT NULL DEFAULT 'Automatic' COMMENT 'Automatic | Manual',
    manufacturer         VARCHAR(150) NOT NULL,
    model                VARCHAR(150) NOT NULL,
    serial_number        VARCHAR(100) NOT NULL,
    charger_type         VARCHAR(10)  NOT NULL COMMENT 'AC | DC',
    connector_type       VARCHAR(50)  NOT NULL COMMENT 'Type 2, CCS2, CHAdeMO, GB/T, Type 1, NACS, …',
    connector_count      TINYINT UNSIGNED NOT NULL DEFAULT 1,
    input_supply         VARCHAR(80)  NOT NULL,
    max_output_voltage_v DECIMAL(8, 2) NOT NULL,
    installation_date    DATE         NOT NULL,
    charger_status       VARCHAR(40)  NOT NULL DEFAULT 'Available' COMMENT 'Available | Faulty | Connection Pending',
    online               VARCHAR(50)  NULL DEFAULT NULL COMMENT '[IoT] Device heartbeat / connectivity token e.g. 323312313',
    sim_iccid            VARCHAR(30)  NULL DEFAULT NULL,
    imei                 VARCHAR(20)  NULL DEFAULT NULL,
    status               TINYINT(1)   NOT NULL DEFAULT 1 COMMENT '1=active row, 0=soft deleted',
    created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_partner_charger_id (charger_id),
    KEY idx_partner_chargers_station (station_id),
    KEY idx_partner_chargers_charger_status (charger_status),
    KEY idx_partner_chargers_charging_type (charging_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- partner_charger_customers — Customers Add page
-- -----------------------------------------------------------------------------
CREATE TABLE partner_charger_customers (
    id                         INT UNSIGNED NOT NULL AUTO_INCREMENT,
    customer_id                VARCHAR(50)  NOT NULL COMMENT 'Business id e.g. PCU-001',
    customer_name              VARCHAR(150) NOT NULL,
    country_code               VARCHAR(10)  NOT NULL DEFAULT '+971',
    mobile_number              VARCHAR(20)  NOT NULL,
    email                      VARCHAR(150) NULL DEFAULT NULL,
    emirates                   VARCHAR(100) NULL DEFAULT NULL,
    address                    TEXT         NULL,
    station_id                 VARCHAR(50)  NOT NULL,
    monthly_session_allocation INT UNSIGNED NOT NULL DEFAULT 0,
    allocated_time_minutes     INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Allocated time in minutes per month',
    kwh_allocation_per_month   DECIMAL(10, 3) NOT NULL DEFAULT 0.000,
    extra_charge_per_min_aed   DECIMAL(10, 4) NOT NULL DEFAULT 0.0000 COMMENT 'AED per minute over allocated time',
    status                     TINYINT(1)   NOT NULL DEFAULT 1 COMMENT '1=active row, 0=soft deleted',
    created_at                 DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                 DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_partner_customer_id (customer_id),
    UNIQUE KEY uq_partner_customer_mobile (mobile_number),
    KEY idx_partner_customer_station (station_id),
    KEY idx_partner_customer_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Multi-select chargers for a customer (must belong to selected station in API layer)
CREATE TABLE partner_customer_charger_map (
    id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
    customer_id  VARCHAR(50)  NOT NULL,
    charger_id   VARCHAR(50)  NOT NULL,
    created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_partner_customer_charger (customer_id, charger_id),
    KEY idx_pccm_charger (charger_id),
    KEY idx_pccm_customer (customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Vehicle section (same shape as community resident vehicles)
CREATE TABLE partner_customer_vehicles (
    id                    INT UNSIGNED NOT NULL AUTO_INCREMENT,
    customer_id           VARCHAR(50)  NOT NULL,
    vehicle_id              VARCHAR(50)  NULL DEFAULT NULL COMMENT 'Optional business id e.g. PVH-001',
    vehicle_type            VARCHAR(80)  NOT NULL,
    vehicle_make            VARCHAR(100) NOT NULL,
    vehicle_model           VARCHAR(100) NOT NULL,
    vehicle_specification   VARCHAR(20)  NOT NULL COMMENT 'GCC | Non-GCC',
    vehicle_emirates        VARCHAR(100) NOT NULL,
    vehicle_code            VARCHAR(30)  NOT NULL,
    vehicle_number          VARCHAR(30)  NOT NULL,
    default_vehicle         TINYINT(1)   NOT NULL DEFAULT 0,
    status                  TINYINT(1)   NOT NULL DEFAULT 1,
    created_at              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_pcv_customer (customer_id),
    KEY idx_pcv_vehicle_id (vehicle_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- IoT tables (unchanged contract — see partner_chargers_iot_tables.sql)
-- -----------------------------------------------------------------------------
CREATE TABLE partner_charger_session_history (
    id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    session_id           VARCHAR(50)  NOT NULL COMMENT '[IoT] Session counter e.g. 1, 2, 3',
    charger_id           VARCHAR(50)  NOT NULL COMMENT '[IoT] Must match partner_chargers.charger_id',
    connector_id         TINYINT      NOT NULL DEFAULT 1 COMMENT '[IoT] Connector index',
    error_code           VARCHAR(255) NULL DEFAULT NULL COMMENT '[IoT] Human-readable fault; NULL when OK',
    status               VARCHAR(40)  NOT NULL COMMENT '[IoT] e.g. charging, completed, failed, fault',
    created_at           DATETIME     NOT NULL COMMENT '[IoT] Event time',
    PRIMARY KEY (id),
    KEY idx_pcsesh_charger_session_time (charger_id, session_id, created_at),
    KEY idx_pcsesh_charger_time (charger_id, created_at),
    KEY idx_pcsesh_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='IoT session events';

CREATE TABLE partner_charger_data_history (
    id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    charger_id           VARCHAR(50)  NOT NULL COMMENT '[IoT] Must match partner_chargers.charger_id',
    connector_id         TINYINT      NOT NULL DEFAULT 1 COMMENT '[IoT] Connector index',
    energy               DECIMAL(12, 4) NULL DEFAULT NULL COMMENT '[IoT] kWh',
    power                DECIMAL(10, 3) NULL DEFAULT NULL COMMENT '[IoT] kW',
    voltage              DECIMAL(8, 2)  NULL DEFAULT NULL COMMENT '[IoT] V',
    current              DECIMAL(8, 2)  NULL DEFAULT NULL COMMENT '[IoT] A',
    created_at           DATETIME     NOT NULL COMMENT '[IoT] Sample time',
    PRIMARY KEY (id),
    KEY idx_pcdh_charger_time (charger_id, created_at),
    KEY idx_pcdh_charger_connector_time (charger_id, connector_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='IoT meter samples';

-- Optional legacy alerts table (deprecated; faults use session_history.error_code)
CREATE TABLE partner_charger_alerts (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    alert_id        VARCHAR(50)  NOT NULL,
    charger_id      VARCHAR(50)  NOT NULL,
    station_id      VARCHAR(50)  NULL DEFAULT NULL,
    station_name    VARCHAR(150) NULL DEFAULT NULL,
    connector_id    TINYINT UNSIGNED NOT NULL DEFAULT 1,
    alert_type      VARCHAR(50)  NOT NULL,
    severity        VARCHAR(20)  NOT NULL DEFAULT 'Warning',
    error_code      VARCHAR(50)  NULL DEFAULT NULL,
    title           VARCHAR(200) NOT NULL,
    description     TEXT         NULL,
    admin_status    VARCHAR(40)  NOT NULL DEFAULT 'Open',
    status          TINYINT(1)   NOT NULL DEFAULT 1,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_partner_alert_id (alert_id),
    KEY idx_pca_charger (charger_id),
    KEY idx_pca_station (station_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `admin_modules` (`module_key`, `label`, `sort_order`)
SELECT 'partner_chargers', 'Partner Chargers Management', 15
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM `admin_modules` WHERE `module_key` = 'partner_chargers'
);