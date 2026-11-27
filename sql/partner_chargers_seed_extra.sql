-- Additional partner station / charger / session seed (dev)
-- Prereq: partner_chargers_admin_tables.sql, partner_chargers_iot_tables.sql,
--         partner_chargers_alerts_table.sql (alerts optional)
--
-- Run: mysql -u USER -p DATABASE < sql/partner_chargers_seed_extra.sql
--
-- Station master login password for all seeds below: "password" (bcrypt below)
-- Emails: mall-station@yopmail.com (ST-02), highway-station@yopmail.com (ST-03)

-- =============================================================================
-- ST-02 — Mall of Emirates Hub (2 chargers)
-- =============================================================================
INSERT INTO partner_charging_stations (
    station_id, station_name, station_type, operator_name, address, city, state_emirate, country,
    latitude, longitude, contact_person, country_code, contact_number, operating_hours, admin_status,
    description, number_of_chargers, master_email, master_password, status
)
SELECT
    'ST-02', 'Mall of Emirates EV Hub', 'Commercial', 'PLUSX',
    'Sheikh Zayed Road, Al Barsha', 'Dubai', 'Dubai', 'UAE',
    25.118107, 55.200608, 'Ahmed Khan', '+971', '501234567', '10 AM - 10 PM', 'Active',
    'Covered parking DC fast + AC destination chargers', 2,
    'mall-station@yopmail.com',
    '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
    1
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM partner_charging_stations WHERE station_id = 'ST-02');

INSERT INTO partner_chargers (
    charger_id, charger_name, station_id, manufacturer, model, serial_number,
    charger_type, rated_power_kw, connector_type, connector_count, input_supply,
    max_output_voltage_v, installation_date, sim_iccid, imei, installation_notes,
    admin_status, status
)
SELECT 'PLX-CH-3', 'Mall DC Fast 120kW', 'ST-02', 'ABB', 'HVC 120', 'SN-ST02-001',
    'DC', 120.00, 'CCS2', 2, 'Industrial', 920.00, CURDATE(), '8988…003', '350000000000003',
    'Dual CCS2 plaza level', 'Available', 1
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM partner_chargers WHERE charger_id = 'PLX-CH-3');

INSERT INTO partner_chargers (
    charger_id, charger_name, station_id, manufacturer, model, serial_number,
    charger_type, rated_power_kw, connector_type, connector_count, input_supply,
    max_output_voltage_v, installation_date, sim_iccid, imei, installation_notes,
    admin_status, status
)
SELECT 'PLX-CH-4', 'Mall AC 22kW', 'ST-02', 'Schneider', 'EVlink', 'SN-ST02-002',
    'AC', 22.00, 'Type 2', 2, 'Three Phase', 400.00, CURDATE(), '8988…004', '350000000000004',
    'Basement long-stay', 'Faulty', 1
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM partner_chargers WHERE charger_id = 'PLX-CH-4');

-- Sessions ST-02 (only if missing)
INSERT INTO partner_charger_session_history (
    session_id, charger_id, connector_id, error_code, status, created_at
)
SELECT '1', 'PLX-CH-3', 1, NULL, 'started', DATE_SUB(NOW(), INTERVAL 5 DAY)
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM partner_charger_session_history
    WHERE charger_id = 'PLX-CH-3' AND session_id = '1' AND status = 'started'
);

INSERT INTO partner_charger_session_history (
    session_id, charger_id, connector_id, error_code, status, created_at
)
SELECT '1', 'PLX-CH-3', 1, NULL, 'charging', DATE_SUB(NOW(), INTERVAL 5 DAY) + INTERVAL 15 MINUTE
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM partner_charger_session_history
    WHERE charger_id = 'PLX-CH-3' AND session_id = '1' AND status = 'charging'
);

INSERT INTO partner_charger_session_history (
    session_id, charger_id, connector_id, error_code, status, created_at
)
SELECT '1', 'PLX-CH-3', 1, NULL, 'completed', DATE_SUB(NOW(), INTERVAL 5 DAY) + INTERVAL 45 MINUTE
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM partner_charger_session_history
    WHERE charger_id = 'PLX-CH-3' AND session_id = '1' AND status = 'completed'
);

INSERT INTO partner_charger_session_history (
    session_id, charger_id, connector_id, error_code, status, created_at
)
SELECT '2', 'PLX-CH-4', 1, NULL, 'started', DATE_SUB(NOW(), INTERVAL 3 HOUR)
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM partner_charger_session_history
    WHERE charger_id = 'PLX-CH-4' AND session_id = '2'
);

INSERT INTO partner_charger_session_history (
    session_id, charger_id, connector_id, error_code, status, created_at
)
SELECT '2', 'PLX-CH-4', 1, 'AC charger ground fault', 'fault', DATE_SUB(NOW(), INTERVAL 2 HOUR) + INTERVAL 50 MINUTE
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM partner_charger_session_history
    WHERE charger_id = 'PLX-CH-4' AND session_id = '2' AND status = 'fault'
);

INSERT INTO partner_charger_data_history (
    charger_id, connector_id, energy, power, voltage, current, created_at
)
SELECT 'PLX-CH-3', 1, 0.0000, 0.00, 400.00, 0.00, DATE_SUB(NOW(), INTERVAL 5 DAY)
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM partner_charger_data_history
    WHERE charger_id = 'PLX-CH-3' AND energy = 0.0000
        AND created_at >= DATE_SUB(NOW(), INTERVAL 6 DAY)
);

INSERT INTO partner_charger_data_history (
    charger_id, connector_id, energy, power, voltage, current, created_at
)
SELECT 'PLX-CH-3', 1, 28.5000, 85.00, 398.00, 214.00,
    DATE_SUB(NOW(), INTERVAL 5 DAY) + INTERVAL 30 MINUTE
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM partner_charger_data_history
    WHERE charger_id = 'PLX-CH-3' AND energy = 28.5000
);

-- =============================================================================
-- ST-03 — Sharjah Highway Plaza (1 charger, active session)
-- =============================================================================
INSERT INTO partner_charging_stations (
    station_id, station_name, station_type, operator_name, address, city, state_emirate, country,
    latitude, longitude, contact_person, country_code, contact_number, operating_hours, admin_status,
    description, number_of_chargers, master_email, master_password, status
)
SELECT
    'ST-03', 'Sharjah Highway Plaza', 'Highway', 'PLUSX',
    'E311 Exit 45, Industrial Area', 'Sharjah', 'Sharjah', 'UAE',
    25.332713, 55.420001, 'Sara Mahmoud', '+971', '509876543', '24 Hours', 'Active',
    'Highway rest stop — single ultra-fast DC', 1,
    'highway-station@yopmail.com',
    '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
    1
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM partner_charging_stations WHERE station_id = 'ST-03');

INSERT INTO partner_chargers (
    charger_id, charger_name, station_id, manufacturer, model, serial_number,
    charger_type, rated_power_kw, connector_type, connector_count, input_supply,
    max_output_voltage_v, installation_date, sim_iccid, imei, installation_notes,
    admin_status, status
)
SELECT 'PLX-CH-5', 'Highway Ultra DC 180kW', 'ST-03', 'Kempower', 'Satellite', 'SN-ST03-001',
    'DC', 180.00, 'CCS2', 1, 'Industrial', 1000.00, CURDATE(), '8988…005', '350000000000005',
    'Canopy-mounted highway unit', 'Charging', 1
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM partner_chargers WHERE charger_id = 'PLX-CH-5');

INSERT INTO partner_charger_session_history (
    session_id, charger_id, connector_id, error_code, status, created_at
)
SELECT '1', 'PLX-CH-5', 1, NULL, 'started', DATE_SUB(NOW(), INTERVAL 35 MINUTE)
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM partner_charger_session_history
    WHERE charger_id = 'PLX-CH-5' AND session_id = '1' AND status = 'started'
);

INSERT INTO partner_charger_session_history (
    session_id, charger_id, connector_id, error_code, status, created_at
)
SELECT '1', 'PLX-CH-5', 1, NULL, 'charging', DATE_SUB(NOW(), INTERVAL 10 MINUTE)
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM partner_charger_session_history
    WHERE charger_id = 'PLX-CH-5' AND session_id = '1' AND status = 'charging'
);

INSERT INTO partner_charger_session_history (
    session_id, charger_id, connector_id, error_code, status, created_at
)
SELECT '3', 'PLX-CH-5', 1, NULL, 'started', DATE_SUB(NOW(), INTERVAL 2 DAY)
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM partner_charger_session_history
    WHERE charger_id = 'PLX-CH-5' AND session_id = '3'
);

INSERT INTO partner_charger_session_history (
    session_id, charger_id, connector_id, error_code, status, created_at
)
SELECT '3', 'PLX-CH-5', 1, NULL, 'completed', DATE_SUB(NOW(), INTERVAL 2 DAY) + INTERVAL 55 MINUTE
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM partner_charger_session_history
    WHERE charger_id = 'PLX-CH-5' AND session_id = '3' AND status = 'completed'
);

INSERT INTO partner_charger_data_history (
    charger_id, connector_id, energy, power, voltage, current, created_at
)
SELECT 'PLX-CH-5', 1, 0.0000, 0.00, 410.00, 0.00, DATE_SUB(NOW(), INTERVAL 33 MINUTE)
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM partner_charger_data_history
    WHERE charger_id = 'PLX-CH-5' AND energy = 0.0000 AND power = 0.00
);

INSERT INTO partner_charger_data_history (
    charger_id, connector_id, energy, power, voltage, current, created_at
)
SELECT 'PLX-CH-5', 1, 14.2000, 120.00, 405.00, 296.00, DATE_SUB(NOW(), INTERVAL 12 MINUTE)
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM partner_charger_data_history
    WHERE charger_id = 'PLX-CH-5' AND energy = 14.2000
);

-- Alerts: add session history rows with error_code text (see PLX-CH-4 session 2 above).
-- Example high-current alert for ST-03:
INSERT INTO partner_charger_session_history (
    session_id, charger_id, connector_id, error_code, status, created_at
)
SELECT '4', 'PLX-CH-5', 1, 'High current draw', 'fault', DATE_SUB(NOW(), INTERVAL 90 MINUTE)
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM partner_charger_session_history
    WHERE charger_id = 'PLX-CH-5' AND session_id = '4' AND status = 'fault'
);