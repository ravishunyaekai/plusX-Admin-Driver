-- Dev seed: partner chargers (sample), IoT session + data history, alerts
-- Prereq: run partner_chargers_admin_tables.sql and partner_chargers_iot_tables.sql (and alerts table).
-- Prereq: at least one station ST-01 (add via admin or insert below).

-- Optional minimal station if missing (password = bcrypt of "password" — change in prod)
INSERT INTO partner_charging_stations (
    station_id, station_name, station_type, operator_name, address, city, state_emirate, country,
    latitude, longitude, contact_person, operating_hours, admin_status, description,
    number_of_chargers, master_email, master_password, status
)
SELECT
    'ST-01', 'PlusX Demo Station', 'Public Station', 'PLUSX',
    'd55, production city', 'Dubai', 'Abu Dhabi', 'UAE',
    24.856556, 54.945917, 'Demo Contact', '9 AM - 9 PM', 'Active', 'Seed station for IoT demos',
    2, 'demo-station@yopmail.com',
    '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
    1
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM partner_charging_stations WHERE station_id = 'ST-01');

INSERT INTO partner_chargers (
    charger_id, charger_name, station_id, manufacturer, model, serial_number,
    charger_type, rated_power_kw, connector_type, connector_count, input_supply,
    max_output_voltage_v, installation_date, sim_iccid, imei, installation_notes,
    admin_status, status
)
SELECT 'PLX-CH-1', 'Demo AC Charger 1', 'ST-01', 'ABB', 'Terra AC', 'SN-DEMO-001',
    'AC', 22.00, 'Type 2', 2, 'Three Phase', 400.00, CURDATE(), '8988…001', '350000000000001',
    'Seed charger for session/alert testing', 'Available', 1
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM partner_chargers WHERE charger_id = 'PLX-CH-1');

INSERT INTO partner_chargers (
    charger_id, charger_name, station_id, manufacturer, model, serial_number,
    charger_type, rated_power_kw, connector_type, connector_count, input_supply,
    max_output_voltage_v, installation_date, sim_iccid, imei, installation_notes,
    admin_status, status
)
SELECT 'PLX-CH-2', 'Demo DC Charger 2', 'ST-01', 'Delta', 'City Charger', 'SN-DEMO-002',
    'DC', 60.00, 'CCS2', 1, 'Industrial', 500.00, CURDATE(), '8988…002', '350000000000002',
    'Second seed charger', 'Charging', 1
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM partner_chargers WHERE charger_id = 'PLX-CH-2');

-- Session 1 on PLX-CH-1: completed (multiple IoT status rows)
INSERT INTO partner_charger_session_history (
    session_id, charger_id, connector_id, error_code, status, created_at
) VALUES
('1', 'PLX-CH-1', 1, NULL, 'started',   DATE_SUB(NOW(), INTERVAL 2 HOUR)),
('1', 'PLX-CH-1', 1, NULL, 'charging',  DATE_SUB(NOW(), INTERVAL 110 MINUTE)),
('1', 'PLX-CH-1', 1, NULL, 'charging',  DATE_SUB(NOW(), INTERVAL 80 MINUTE)),
('1', 'PLX-CH-1', 1, NULL, 'completed', DATE_SUB(NOW(), INTERVAL 65 MINUTE));

-- Session 2 on PLX-CH-1: failed
INSERT INTO partner_charger_session_history (
    session_id, charger_id, connector_id, error_code, status, created_at
) VALUES
('2', 'PLX-CH-1', 2, 'E-204', 'started',  DATE_SUB(NOW(), INTERVAL 40 MINUTE)),
('2', 'PLX-CH-1', 2, 'E-204', 'charging', DATE_SUB(NOW(), INTERVAL 35 MINUTE)),
('2', 'PLX-CH-1', 2, 'E-204', 'fault',    DATE_SUB(NOW(), INTERVAL 30 MINUTE)),
('2', 'PLX-CH-1', 2, 'E-204', 'failed',   DATE_SUB(NOW(), INTERVAL 28 MINUTE));

-- Session 3 on PLX-CH-2: in progress (charging)
INSERT INTO partner_charger_session_history (
    session_id, charger_id, connector_id, error_code, status, created_at
) VALUES
('1', 'PLX-CH-2', 1, NULL, 'started',  DATE_SUB(NOW(), INTERVAL 20 MINUTE)),
('1', 'PLX-CH-2', 1, NULL, 'charging', DATE_SUB(NOW(), INTERVAL 5 MINUTE));

UPDATE partner_charger_session_history AS sh
INNER JOIN partner_chargers AS pc ON pc.charger_id = sh.charger_id AND pc.status = 1
INNER JOIN partner_charging_stations AS ps ON ps.station_id = pc.station_id AND ps.status = 1
SET sh.station_id = ps.station_id,
    sh.station_name = ps.station_name
WHERE sh.station_id IS NULL OR sh.station_name IS NULL;

-- Meter samples (session 1 window on PLX-CH-1)
INSERT INTO partner_charger_data_history (
    charger_id, connector_id, energy, power, voltage, current, created_at
) VALUES
('PLX-CH-1', 1, 0.0000,  0.00, 230.00, 0.00, DATE_SUB(NOW(), INTERVAL 115 MINUTE)),
('PLX-CH-1', 1, 5.2500, 18.50, 230.00, 32.10, DATE_SUB(NOW(), INTERVAL 90 MINUTE)),
('PLX-CH-1', 1, 12.8000, 19.20, 229.50, 33.00, DATE_SUB(NOW(), INTERVAL 70 MINUTE)),
('PLX-CH-1', 1, 15.1000,  0.00, 230.00, 0.00, DATE_SUB(NOW(), INTERVAL 66 MINUTE)),
('PLX-CH-2', 1, 0.0000,  0.00, 400.00, 0.00, DATE_SUB(NOW(), INTERVAL 18 MINUTE)),
('PLX-CH-2', 1, 8.4000, 45.00, 398.00, 112.50, DATE_SUB(NOW(), INTERVAL 8 MINUTE));

INSERT INTO partner_charger_alerts (
    alert_id, charger_id, station_id, station_name, connector_id,
    alert_type, severity, error_code, title, description, admin_status, status
)
SELECT 'ALT-01', 'PLX-CH-1', 'ST-01', 'PlusX Demo Station', 2,
    'Fault', 'Critical', 'E-204', 'Connector fault during session',
    'Session S-2 ended with error E-204 on connector 2.', 'Open', 1
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM partner_charger_alerts WHERE alert_id = 'ALT-01');

INSERT INTO partner_charger_alerts (
    alert_id, charger_id, station_id, station_name, connector_id,
    alert_type, severity, error_code, title, description, admin_status, status
)
SELECT 'ALT-02', 'PLX-CH-2', 'ST-01', 'PlusX Demo Station', 1,
    'Communication', 'Warning', NULL, 'Intermittent telemetry',
    'Meter samples delayed > 2 minutes (demo seed).', 'Acknowledged', 1
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM partner_charger_alerts WHERE alert_id = 'ALT-02');