-- DEPRECATED — Alerts are served from partner_charger_session_history.error_code.
-- IoT writes human-readable fault messages on session rows; list APIs no longer use this table.
-- Safe to DROP after confirming no legacy data is needed:
--   DROP TABLE IF EXISTS partner_charger_alerts;

CREATE TABLE IF NOT EXISTS partner_charger_alerts (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    alert_id        VARCHAR(50)  NOT NULL COMMENT 'Business id e.g. ALT-01',
    charger_id      VARCHAR(50)  NOT NULL,
    station_id      VARCHAR(50)  NULL DEFAULT NULL,
    station_name    VARCHAR(150) NULL DEFAULT NULL,
    connector_id    TINYINT UNSIGNED NOT NULL DEFAULT 1,
    alert_type      VARCHAR(50)  NOT NULL COMMENT 'e.g. Fault, Offline, Communication, Overcurrent',
    severity        VARCHAR(20)  NOT NULL DEFAULT 'Warning' COMMENT 'Critical, Warning, Info',
    error_code      VARCHAR(50)  NULL DEFAULT NULL,
    title           VARCHAR(200) NOT NULL,
    description     TEXT         NULL,
    admin_status    VARCHAR(40)  NOT NULL DEFAULT 'Open' COMMENT 'Open, Acknowledged, Resolved',
    status          TINYINT(1)   NOT NULL DEFAULT 1 COMMENT '1=active row, 0=soft deleted',
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_partner_alert_id (alert_id),
    KEY idx_pca_charger (charger_id),
    KEY idx_pca_station (station_id),
    KEY idx_pca_admin_status (admin_status),
    KEY idx_pca_severity (severity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;