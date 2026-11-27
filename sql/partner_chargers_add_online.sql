-- Add IoT-maintained connectivity flag on partner_chargers.
--
--   mysql -u USER -p DATABASE < sql/partner_chargers_add_online.sql

ALTER TABLE partner_chargers
    ADD COLUMN online VARCHAR(50) NULL DEFAULT NULL
        COMMENT '[IoT] Device heartbeat / connectivity token e.g. 323312313'
        AFTER charger_status;