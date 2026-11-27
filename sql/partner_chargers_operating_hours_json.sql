-- Store weekly operating hours as JSON text (admin UI: Always Open + Mon–Sun open/close).
--
--   mysql -u USER -p DATABASE < sql/partner_chargers_operating_hours_json.sql

ALTER TABLE partner_charging_stations
    MODIFY COLUMN operating_hours TEXT NOT NULL
        COMMENT 'JSON: always_open + schedule { monday: { open, close, closed }, ... }';