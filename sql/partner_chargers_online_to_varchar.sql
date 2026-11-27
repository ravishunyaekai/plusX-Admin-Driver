-- If online was created as TINYINT(1), widen to IoT token string.
-- Ignore if column is already VARCHAR or does not exist yet.
--
--   mysql -u USER -p DATABASE < sql/partner_chargers_online_to_varchar.sql

ALTER TABLE partner_chargers
    MODIFY COLUMN online VARCHAR(50) NULL DEFAULT NULL
        COMMENT '[IoT] Device heartbeat / connectivity token e.g. 323312313';