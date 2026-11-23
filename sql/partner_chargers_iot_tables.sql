-- =============================================================================
-- PARTNER CHARGERS — IOT DATA CONTRACT (share table names + columns with IoT team)
-- =============================================================================
--
-- TABLE A (IoT writes):  partner_charger_session_history
-- TABLE B (IoT writes):  partner_charger_data_history
--
-- Admin tables (PlusX only, not IoT): partner_charging_stations, partner_chargers
--   IoT must use charger_id values that exist in partner_chargers.
--
-- No mobile app user / rider — public charging at partner stations only.
-- Session list "User" column = station_id + station_name (computed in API, not stored).
--   station_id / station_name filled by PlusX from partner_chargers, NOT by IoT.
--
-- Session list UI (PlusX API builds from both tables + admin JOIN):
--   display_session_id  → CONCAT('S-', session_id)     e.g. S-1, S-1047
--   charger_id            → from IoT session rows
--   user (UI column)      → CONCAT(station_id, ' — ', station_name) in PlusX API
--   start_time            → MIN(created_at) per session group
--   duration              → from start/end (PlusX)
--   status                → latest status row per session
--   energy (detail only)  → 2nd-last energy in partner_charger_data_history
--                           for charger_id (list omits energy per product rule;
--                           optional if UI shows kWh on list from summary)
--
-- =============================================================================


-- -----------------------------------------------------------------------------
-- TABLE A — partner_charger_session_history
-- -----------------------------------------------------------------------------
-- *** IoT INSERT these columns only ***
--   session_id, charger_id, connector_id, error_code, status, created_at
--
-- Multiple rows per (charger_id, session_id).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS partner_charger_session_history (
    id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    session_id           VARCHAR(50)  NOT NULL COMMENT '[IoT] Session counter e.g. 1, 2, 3',
    charger_id           VARCHAR(50)  NOT NULL COMMENT '[IoT] Must match partner_chargers.charger_id e.g. PLX-CHG-1001',
    connector_id         TINYINT      NOT NULL DEFAULT 1 COMMENT '[IoT] Connector index',
    error_code           VARCHAR(50)  NULL DEFAULT NULL COMMENT '[IoT] Error/fault code or NULL',
    status               VARCHAR(40)  NOT NULL COMMENT '[IoT] e.g. charging, completed, failed, fault',
    created_at           DATETIME     NOT NULL COMMENT '[IoT] Event time (insert-only; no row updates)',
    station_id           VARCHAR(50)  NULL DEFAULT NULL COMMENT '[PlusX ONLY] From partner_chargers → station',
    station_name         VARCHAR(150) NULL DEFAULT NULL COMMENT '[PlusX ONLY] From partner_charging_stations',
    PRIMARY KEY (id),
    KEY idx_pcsesh_charger_session_time (charger_id, session_id, created_at),
    KEY idx_pcsesh_charger_time (charger_id, created_at),
    KEY idx_pcsesh_station (station_id),
    KEY idx_pcsesh_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='IoT: session events. PlusX sets station_id, station_name for list/filter.';


-- -----------------------------------------------------------------------------
-- TABLE B — partner_charger_data_history
-- -----------------------------------------------------------------------------
-- *** IoT INSERT these columns only ***
--   charger_id, connector_id, energy, power, voltage, current, created_at
--
-- Multiple rows per charger (energy changes over time).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS partner_charger_data_history (
    id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    charger_id           VARCHAR(50)  NOT NULL COMMENT '[IoT] Must match partner_chargers.charger_id',
    connector_id         TINYINT      NOT NULL DEFAULT 1 COMMENT '[IoT] Connector index',
    energy               DECIMAL(12,4) NULL DEFAULT NULL COMMENT '[IoT] Energy reading at sample (kWh per IoT contract)',
    power                DECIMAL(10,3) NULL DEFAULT NULL COMMENT '[IoT] Power kW',
    voltage              DECIMAL(8,2)  NULL DEFAULT NULL COMMENT '[IoT] Voltage V',
    current              DECIMAL(8,2)  NULL DEFAULT NULL COMMENT '[IoT] Current A',
    created_at           DATETIME     NOT NULL COMMENT '[IoT] Sample time (insert-only; no row updates)',
    PRIMARY KEY (id),
    KEY idx_pcdh_charger_time (charger_id, created_at),
    KEY idx_pcdh_charger_connector_time (charger_id, connector_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='IoT: meter samples only';


-- =============================================================================
-- FOR IOT TEAM (copy/paste)
-- =============================================================================
--
-- 1) partner_charger_session_history
--    Fields you write: session_id, charger_id, connector_id, error_code, status, created_at
--    Do NOT write: id, station_id, station_name (PlusX)
--
-- 2) partner_charger_data_history
--    Fields you write: charger_id, connector_id, energy, power, voltage, current, created_at
--    Do NOT write: id
--
-- =============================================================================
-- PLUSX — how session list fields are produced
-- =============================================================================
--
-- After IoT insert (job/trigger/API): set station on session rows (no rider/app user)
--   UPDATE partner_charger_session_history AS sh
--   INNER JOIN partner_chargers AS pc ON pc.charger_id = sh.charger_id AND pc.status = 1
--   INNER JOIN partner_charging_stations AS ps ON ps.station_id = pc.station_id AND ps.status = 1
--   SET sh.station_id = ps.station_id,
--       sh.station_name = ps.station_name
--   WHERE sh.station_id IS NULL OR sh.station_name IS NULL;
--
-- List query (one row per charger_id + session_id):
--   session_id, display_session_id = CONCAT('S-', session_id),
--   charger_id, station_id, station_name, user (UI "User" = API concat station fields),
--   MIN(created_at) AS start_time, MAX(created_at) AS end_time,
--   duration from timestamps, latest status, error_code from latest row
--
-- Detail energy:
--   SELECT energy FROM partner_charger_data_history
--   WHERE charger_id = ? ORDER BY created_at DESC LIMIT 1 OFFSET 1
--   (optionally restrict created_at between session start/end)
-- =============================================================================

UPDATE partner_charger_session_history AS sh
INNER JOIN partner_chargers AS pc ON pc.charger_id = sh.charger_id AND pc.status = 1
INNER JOIN partner_charging_stations AS ps ON ps.station_id = pc.station_id AND ps.status = 1
SET sh.station_id = ps.station_id,
    sh.station_name = ps.station_name
WHERE sh.station_id IS NULL OR sh.station_name IS NULL;

-- Existing deployments (ignore errors if column already dropped / never existed)
ALTER TABLE partner_charger_session_history DROP COLUMN user;
ALTER TABLE partner_charger_session_history DROP COLUMN updated_at;
ALTER TABLE partner_charger_data_history DROP COLUMN updated_at;