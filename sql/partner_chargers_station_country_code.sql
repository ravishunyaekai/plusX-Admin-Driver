-- Add country_code to partner_charging_stations; store local contact_number only.
-- Run once on existing databases (ignore duplicate column if re-run).

ALTER TABLE partner_charging_stations
    ADD COLUMN country_code VARCHAR(10) NOT NULL DEFAULT '+971' AFTER contact_person;

UPDATE partner_charging_stations
SET country_code = '+971'
WHERE TRIM(COALESCE(country_code, '')) = '';

UPDATE partner_charging_stations
SET country_code = '+971',
    contact_number = TRIM(LEADING '-' FROM TRIM(LEADING ' ' FROM SUBSTRING(contact_number, 5)))
WHERE contact_number LIKE '+971-%';

UPDATE partner_charging_stations
SET country_code = '+971',
    contact_number = TRIM(LEADING '0' FROM TRIM(SUBSTRING(contact_number, 5)))
WHERE contact_number LIKE '+971%'
  AND contact_number NOT LIKE '+971-%';