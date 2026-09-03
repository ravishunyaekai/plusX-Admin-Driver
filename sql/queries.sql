-- queries for 01-09-2026 live update

//Offline EV Roadside Assistance tables
 
CREATE TABLE IF NOT EXISTS rsa_offline_booking (
    id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
    request_id           VARCHAR(50)  NOT NULL,
    rider_id             VARCHAR(50)  NULL DEFAULT NULL,
    customer_name        VARCHAR(150) NOT NULL,
    mobile_no            VARCHAR(20)  NOT NULL,
    email_id             VARCHAR(150) NOT NULL,
    country_code         VARCHAR(10)  NOT NULL DEFAULT '+971',
    location_link        TEXT         NULL,
    address              TEXT         NOT NULL,
    price                DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    jump_start_required  ENUM('Yes', 'No') NOT NULL DEFAULT 'No',
    battery_level        INT          NULL DEFAULT 0,
    vehicle_data         VARCHAR(255) NULL COMMENT 'Vehicle make and model',
    booking_price        DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    order_status         VARCHAR(20)  NOT NULL DEFAULT 'CNF',
    payment_status       VARCHAR(50)  NULL DEFAULT 'Pending',
    mode_of_payment      VARCHAR(50)  NULL,
    rsa_id               VARCHAR(50)  NULL,
    transaction_id       VARCHAR(100) NULL,
    proof_of_transaction VARCHAR(255) NULL,
    booking_date         DATE         NULL,
    booking_completed_date DATE       NULL,
    created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_rsa_offline_booking_request_id (request_id),
    KEY idx_rsa_offline_booking_rider_id (rider_id),
    KEY idx_rsa_offline_booking_mobile_no (mobile_no),
    KEY idx_rsa_offline_booking_order_status (order_status),
    KEY idx_rsa_offline_booking_rsa_id (rsa_id),
    KEY idx_rsa_offline_booking_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
 
CREATE TABLE IF NOT EXISTS rsa_offline_order_history (
    id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
    order_id      VARCHAR(50)  NOT NULL,
    rider_id      VARCHAR(50)  NULL DEFAULT NULL,
    driver_name   VARCHAR(150) NULL,
    rsa_id        VARCHAR(50)  NULL,
    order_status  VARCHAR(20)  NOT NULL,
    remarks       TEXT         NULL,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_rsa_offline_history_order_id (order_id),
    KEY idx_rsa_offline_history_rider_id (rider_id),
    KEY idx_rsa_offline_history_rsa_id (rsa_id),
    KEY idx_rsa_offline_history_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
 
CREATE TABLE IF NOT EXISTS rsa_offline_invoice (
    id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
    invoice_id      VARCHAR(50)  NOT NULL,
    request_id      VARCHAR(50)  NOT NULL,
    rider_id        VARCHAR(50)  NULL DEFAULT NULL,
    amount          DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    transaction_id  VARCHAR(100) NULL,
    payment_status  VARCHAR(50)  NULL DEFAULT 'Pending',
    invoice_date    DATETIME     NOT NULL,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_rsa_offline_invoice_invoice_id (invoice_id),
    KEY idx_rsa_offline_invoice_request_id (request_id),
    KEY idx_rsa_offline_invoice_rider_id (rider_id),
    KEY idx_rsa_offline_invoice_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Existing rsa_offline_booking tables: add booking date columns
ALTER TABLE rsa_offline_booking
    ADD COLUMN booking_date DATE NULL AFTER proof_of_transaction,
    ADD COLUMN booking_completed_date DATE NULL AFTER booking_date;

----------------------------------------------------------  ----------------------------------------------------------



-- updated response content for pod service unavailable
 
INSERT INTO response_content (
    module_name,
    response_type,
    sub_module,
    content,
    additional_content,
    status,
    created_at,
    updated_at
) VALUES
(
    'portable-charger',
    'service-unavailable',
    'booking-full-popup',
    'All our pods are fully booked for this month!',
    NULL,
    1,
    NOW(),
    NOW()
),
(
    'portable-charger',
    'service-unavailable',
    'booking-full-popup',
    'If you’re stranded or need emergency EV charging assistance, please call us directly',
    '+971543061473',
    1,
    NOW(),
    NOW()
);
 
 
INSERT INTO response_module (
    name,
    heading,
    sub_module,
    status,
    created_at,
    updated_at
) VALUES (
    'portable-charger',
    'Portable POD Currently Unavailable!',
    'service-unavailable',
    1,
    NOW(),
    NOW()
);

-------------------------------------------------------------------------------------------------------------------------




-- Charger Installation Inquiry Tracking
 
CREATE TABLE IF NOT EXISTS charger_installation_inquiry (
    id                          INT UNSIGNED NOT NULL AUTO_INCREMENT,
    inquiry_id                  VARCHAR(50)  NOT NULL,
    customer_name               VARCHAR(150) NOT NULL,
    mobile_no                   VARCHAR(20)  NOT NULL,
    country_code                VARCHAR(10)  NOT NULL DEFAULT '+971',
    email_id                    VARCHAR(150) NOT NULL,
    lead_source                 VARCHAR(50)  NOT NULL,
    assigned_person_name        VARCHAR(150) NOT NULL,
    customer_feedback           TEXT         NULL,
    follow_up_required          ENUM('Yes', 'No') NULL,
    next_follow_up_date         DATE         NULL,
    follow_up_remarks           TEXT         NULL,
    site_visit_required         ENUM('Yes', 'No') NULL,
    site_visit_date             DATE         NULL,
    site_visit_time             VARCHAR(20)  NULL,
    site_visit_location         TEXT         NULL,
    site_visit_person           VARCHAR(150) NULL,
    site_visit_status           VARCHAR(50)  NULL,
    site_visit_remarks          TEXT         NULL,
    cabling_required            ENUM('Yes', 'No') NULL,
    civil_work_required         ENUM('Yes', 'No') NULL,
    existing_electrical_setup   TEXT         NULL,
    charger_availability        VARCHAR(50)  NULL,
    charger_capacity            VARCHAR(100) NULL,
    charger_cost                DECIMAL(10, 2) NULL,
    material_requirement_details TEXT        NULL,
    material_cost_to_us         DECIMAL(10, 2) NULL,
    material_cost_quoted        DECIMAL(10, 2) NULL,
    installation_date           DATE         NULL,
    installation_person         VARCHAR(150) NULL,
    installation_completion_date DATE        NULL,
    installation_completed_by   VARCHAR(150) NULL,
    final_amount                DECIMAL(10, 2) NULL,
    completion_certificate      VARCHAR(255) NULL,
    charger_purchase_invoice    VARCHAR(255) NULL,
    -- enquiry_status shorthand: ASG=Assigned, CTC=Contacted, FUR=Follow-up Required,
    -- SVP=Site Visit Planned, SVC=Site Visit Completed, QSH=Quotation Shared,
    -- ISC=Installation Scheduled, INC=Installation Completed, LCN=Lost / Cancelled
    enquiry_status              ENUM('ASG', 'CTC', 'FUR', 'SVP', 'SVC', 'QSH', 'ISC', 'INC', 'LCN') NOT NULL,
    lost_cancelled_remark       TEXT         NULL,
    created_at                  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_charger_installation_inquiry_id (inquiry_id),
    KEY idx_charger_installation_inquiry_mobile (mobile_no),
    KEY idx_charger_installation_inquiry_lead_source (lead_source),
    KEY idx_charger_installation_inquiry_enquiry_status (enquiry_status),
    KEY idx_charger_installation_inquiry_site_visit_status (site_visit_status),
    KEY idx_charger_installation_inquiry_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-------------------------------------------------------------------------------------------------------------------------

-- new pod terms and conditions

UPDATE response_content
SET status = 0,
    updated_at = NOW()
WHERE module_name = 'portable-charger'
  AND response_type IS NULL;
 
 
 
INSERT INTO response_content
  (module_name, response_type, sub_module, content, additional_content, image, status, created_at, updated_at)
VALUES
  ('portable-charger', NULL, NULL, 'The 30 kW mobile charging service takes approximately 1 hour and 20 minutes to complete.', NULL, NULL, 1, NOW(), NOW()),
  ('portable-charger', NULL, NULL, 'Cancellations are non-refundable.', NULL, NULL, 1, NOW(), NOW()),
  ('portable-charger', NULL, NULL, 'The booking can be rescheduled up to 24 hours before the scheduled time. Only the date and time can be changed.', NULL, NULL, 1, NOW(), NOW()),
  ('portable-charger', NULL, NULL, 'The vehicle must have a minimum charge of 10%. If the vehicle’s charge is below 10%, charging will not be carried out, and the booking fee will be non-refundable.', NULL, NULL, 1, NOW(), NOW()),
  ('portable-charger', NULL, NULL, 'All vehicles will be charged up to 80% only.', NULL, NULL, 1, NOW(), NOW()),
  ('portable-charger', NULL, NULL, 'The vehicle must be physically available at the service location during the booked time slot.', NULL, NULL, 1, NOW(), NOW()),
  ('portable-charger', NULL, NULL, 'The maximum idle waiting time at the site is strictly limited to 5 minutes.', NULL, NULL, 1, NOW(), NOW()),
  ('portable-charger', NULL, NULL, 'Parking access and any associated parking fees are the sole responsibility of the customer.', NULL, NULL, 1, NOW(), NOW()),
  ('portable-charger', NULL, NULL, 'If the vehicle’s 12V battery requires a jump start, an additional fee of AED 120 + VAT will be charged.', NULL, NULL, 1, NOW(), NOW());


  -------------------------------------------------------------------------------------------------------------------------

-- new pod booking price

  ALTER TABLE booking_price
ADD COLUMN portable_original_price DECIMAL(10,2) NULL DEFAULT NULL;
 
UPDATE booking_price
SET portable_price = 99,
    portable_original_price = 129
WHERE id = 1;

-------------------------------------------------------------------------------------------------------------------------


-- query to update pod booking service_name
UPDATE portable_charger_booking
SET service_name = 'Mobile & Portable EV Charging Service'
WHERE service_name = 'E POD'; -- E-POD


-------------------------------------------------------------------------------------------------------------------------

-- query to add country_code to resident table
ALTER TABLE community_resident
  ADD COLUMN country_code VARCHAR(10) NOT NULL DEFAULT '+971' AFTER resident_name;


-------------------------------------------------------------------------------------------------------------------------

-- query to add community_resident_map table

CREATE TABLE community_resident_map (
    id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
    resident_id  VARCHAR(50)  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
    community_id VARCHAR(50)  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
    created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_resident_community (resident_id, community_id),
    KEY idx_map_community (community_id),
    KEY idx_map_resident (resident_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
 

-- add existing residents to community_resident_map table
INSERT INTO community_resident_map (resident_id, community_id)
SELECT resident_id, community_id
FROM community_resident
WHERE community_id IS NOT NULL AND community_id != '';


-------------------------------------------------------------------------------------------------------------------------











 
