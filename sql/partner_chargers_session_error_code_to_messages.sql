-- One-time data fix: replace legacy fault *codes* in partner_charger_session_history.error_code
-- with human-readable messages (IoT should send messages directly going forward).
--
-- Safe to re-run: only rows that still look like E-### / W-### codes are updated.

UPDATE partner_charger_session_history
SET error_code = CASE UPPER(TRIM(error_code))
    WHEN 'E-101' THEN 'AC charger ground fault'
    WHEN 'E-202' THEN 'High current draw'
    WHEN 'E-203' THEN 'Overvoltage detected'
    WHEN 'E-204' THEN 'AC charger ground fault'
    WHEN 'E-205' THEN 'Connector communication lost'
    WHEN 'E-206' THEN 'Emergency stop activated'
    WHEN 'E-207' THEN 'Temperature limit exceeded'
    WHEN 'W-401' THEN 'Sustained high current draw'
    WHEN 'W-402' THEN 'High current draw'
    WHEN 'W-403' THEN 'Intermittent telemetry delay'
    ELSE CONCAT('Equipment fault (', TRIM(error_code), ')')
END
WHERE error_code IS NOT NULL
  AND TRIM(error_code) <> ''
  AND UPPER(TRIM(error_code)) REGEXP '^[EW]-[0-9]+$';