-- =============================================================================
-- community_managers
-- =============================================================================

CREATE TABLE IF NOT EXISTS `plusx-node`.`community_managers` (
    id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
    manager_id       VARCHAR(50)  NOT NULL,
    community_id     VARCHAR(50)  NOT NULL,
    manager_name     VARCHAR(150) NOT NULL,
    manager_email    VARCHAR(150) NOT NULL,
    manager_contact  VARCHAR(20)  NOT NULL,
    password         VARCHAR(255) NOT NULL,
    status           TINYINT(1)   NOT NULL DEFAULT 1,
    created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_community_managers_manager_id (manager_id),
    UNIQUE KEY uq_community_managers_email (manager_email),
    UNIQUE KEY uq_community_managers_contact (manager_contact),
    KEY idx_community_managers_community_id (community_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-----------------------------------------------------------------------------------------------------

ALTER TABLE `plusx-node`.`community_managers`
    ADD COLUMN country_code VARCHAR(10) NOT NULL DEFAULT '+971' AFTER manager_email;

-----------------------------------------------------------------------------------------------------

-- manager_contact is optional; NULL (not '') lets multiple managers skip it without hitting the unique key
ALTER TABLE `plusx-node`.`community_managers`
    MODIFY COLUMN manager_contact VARCHAR(20) NULL DEFAULT NULL;

UPDATE `plusx-node`.`community_managers`
SET manager_contact = NULL
WHERE manager_contact = '';

-----------------------------------------------------------------------------------------------------


-- =============================================================================
-- purchase_history
-- =============================================================================

ALTER TABLE `plusx-node`.`purchase_history`
    ADD COLUMN country_code VARCHAR(10) NOT NULL DEFAULT '+971' AFTER customer_email;

-----------------------------------------------------------------------------------------------------


-- =============================================================================
-- charger_installation_inquiry
-- =============================================================================

ALTER TABLE `plusx-node`.`charger_installation_inquiry`
    MODIFY COLUMN email_id                     VARCHAR(150) NULL,
    MODIFY COLUMN assigned_person_name         VARCHAR(150) NULL,
    MODIFY COLUMN customer_feedback            TEXT         NULL,
    MODIFY COLUMN follow_up_required           ENUM('Yes', 'No') NULL,
    MODIFY COLUMN next_follow_up_date          DATE         NULL,
    MODIFY COLUMN follow_up_remarks            TEXT         NULL,
    MODIFY COLUMN site_visit_required          ENUM('Yes', 'No') NULL,
    MODIFY COLUMN site_visit_date              DATE         NULL,
    MODIFY COLUMN site_visit_time              VARCHAR(20)  NULL,
    MODIFY COLUMN site_visit_location          TEXT         NULL,
    MODIFY COLUMN site_visit_person            VARCHAR(150) NULL,
    MODIFY COLUMN site_visit_status            VARCHAR(50)  NULL,
    MODIFY COLUMN site_visit_remarks           TEXT         NULL,
    MODIFY COLUMN cabling_required             ENUM('Yes', 'No') NULL,
    MODIFY COLUMN civil_work_required          ENUM('Yes', 'No') NULL,
    MODIFY COLUMN existing_electrical_setup    TEXT         NULL,
    MODIFY COLUMN charger_availability         VARCHAR(50)  NULL,
    MODIFY COLUMN charger_capacity             VARCHAR(100) NULL,
    MODIFY COLUMN charger_cost                 DECIMAL(10, 2) NULL,
    MODIFY COLUMN material_requirement_details TEXT         NULL,
    MODIFY COLUMN material_cost_to_us          DECIMAL(10, 2) NULL,
    MODIFY COLUMN material_cost_quoted         DECIMAL(10, 2) NULL,
    MODIFY COLUMN installation_date            DATE         NULL,
    MODIFY COLUMN installation_person          VARCHAR(150) NULL,
    MODIFY COLUMN installation_completion_date DATE         NULL,
    MODIFY COLUMN installation_completed_by    VARCHAR(150) NULL,
    MODIFY COLUMN final_amount                 DECIMAL(10, 2) NULL,
    MODIFY COLUMN completion_certificate       VARCHAR(255) NULL,
    MODIFY COLUMN charger_purchase_invoice     VARCHAR(255) NULL,
    MODIFY COLUMN lost_cancelled_remark        TEXT         NULL;

-----------------------------------------------------------------------------------------------------

ALTER TABLE `plusx-node`.`charger_installation_inquiry`
    ADD COLUMN whatsapp_sent        TINYINT(1)  NOT NULL DEFAULT 0 AFTER lost_cancelled_remark,
    ADD COLUMN whatsapp_campaign_id VARCHAR(50) NULL AFTER whatsapp_sent;

-----------------------------------------------------------------------------------------------------

ALTER TABLE `plusx-node`.`charger_installation_inquiry`
    ADD COLUMN rider_id VARCHAR(50) NULL DEFAULT NULL AFTER inquiry_id,
    ADD KEY idx_charger_installation_inquiry_rider_id (rider_id);

-----------------------------------------------------------------------------------------------------

UPDATE `plusx-node`.`charger_installation_inquiry` cii
INNER JOIN `plusx-node`.`riders` r ON r.rider_mobile = cii.mobile_no
SET cii.rider_id = r.rider_id
WHERE cii.rider_id IS NULL;

-----------------------------------------------------------------------------------------------------

ALTER TABLE `plusx-node`.`charger_installation_inquiry`
    ADD COLUMN emirates VARCHAR(100) NULL DEFAULT NULL AFTER email_id;

-----------------------------------------------------------------------------------------------------


-- =============================================================================
-- rsa_offline_booking
-- =============================================================================

ALTER TABLE `plusx-node`.`rsa_offline_booking`
    ADD COLUMN emirates VARCHAR(100) NULL DEFAULT NULL AFTER address;

-----------------------------------------------------------------------------------------------------

ALTER TABLE `plusx-node`.`rsa_offline_booking`
    ADD COLUMN cancellation_remarks TEXT        NULL AFTER booking_completed_date,
    ADD COLUMN cancelled_by         VARCHAR(50) NULL AFTER cancellation_remarks;

-----------------------------------------------------------------------------------------------------

ALTER TABLE `plusx-node`.`rsa_offline_booking`
    ADD COLUMN whatsapp_sent        TINYINT(1)  NOT NULL DEFAULT 0 AFTER cancelled_by,
    ADD COLUMN whatsapp_campaign_id VARCHAR(50) NULL AFTER whatsapp_sent;

-----------------------------------------------------------------------------------------------------


-- =============================================================================
-- riders
-- =============================================================================

ALTER TABLE `plusx-node`.`riders`
    MODIFY COLUMN added_from VARCHAR(50) NULL DEFAULT NULL;

-----------------------------------------------------------------------------------------------------

UPDATE `plusx-node`.`riders`
SET added_from = 'Rsa Offline'
WHERE added_from IN ('Admin Offline', 'Admin Offl');

-----------------------------------------------------------------------------------------------------
