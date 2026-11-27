-- Operational hours are stored as JSON in partner_charging_stations.operating_hours (TEXT/JSON).
-- Example: {"always_open":false,"schedule":{"monday":{"open":"09:00","close":"18:00","closed":false},...}}
-- If your column is VARCHAR(80), widen it:
ALTER TABLE partner_charging_stations
    MODIFY COLUMN operating_hours TEXT NOT NULL
    COMMENT 'JSON weekly schedule or legacy label';