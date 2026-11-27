-- Drop denormalized station fields from IoT session history (station resolved via charger_id in API).
-- Safe to re-run: ignore errors if index/columns already removed.
--
--   mysql -u USER -p DATABASE < sql/partner_chargers_session_history_drop_station_columns.sql

ALTER TABLE partner_charger_session_history DROP INDEX idx_pcsesh_station;
ALTER TABLE partner_charger_session_history DROP COLUMN station_id;
ALTER TABLE partner_charger_session_history DROP COLUMN station_name;