


-----------------------------------------------------------------------------
UPDATE `plusx-node`.`coupon`
SET created_at = updated_at
WHERE created_at = '0000-00-00 00:00:00';


-----------------------------------------------------------------------------
ALTER TABLE `plusx-node`.`rsa_offline_booking`
    ADD COLUMN is_booking_completed ENUM('Yes', 'No') NOT NULL DEFAULT 'Yes' AFTER rider_id;


ALTER TABLE `plusx-node`.`rsa_offline_booking`
    MODIFY COLUMN customer_name VARCHAR(150) NULL DEFAULT NULL,
    MODIFY COLUMN mobile_no     VARCHAR(20)  NULL DEFAULT NULL,
    MODIFY COLUMN email_id      VARCHAR(150) NULL DEFAULT NULL,
    MODIFY COLUMN address       TEXT         NULL;


-----------------------------------------------------------------------------
ALTER TABLE `plusx-node`.`rsa_offline_booking`
    MODIFY COLUMN mobile_no VARCHAR(20) NULL DEFAULT NULL;


----------------------------------------------------------------------------
ALTER TABLE `plusx-node`.`community_resident`
    ADD COLUMN emirates VARCHAR(100) NULL DEFAULT NULL AFTER address;
