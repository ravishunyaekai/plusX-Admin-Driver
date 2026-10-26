-- =============================================================================
-- community_resident : emirates (resident location)  (16-10-2026)
-- =============================================================================
-- Used when adding a community resident along with vehicle details.

ALTER TABLE `plusx-node`.`community_resident`
    ADD COLUMN emirates VARCHAR(100) NULL DEFAULT NULL AFTER address;
