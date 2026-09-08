-- Add country_code to community_managers
ALTER TABLE community_managers
    ADD COLUMN country_code VARCHAR(10) NOT NULL DEFAULT '+971' AFTER manager_email;
