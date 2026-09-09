-- Add country_code to purchase_history
ALTER TABLE purchase_history
    ADD COLUMN country_code VARCHAR(10) NOT NULL DEFAULT '+971' AFTER customer_email;
