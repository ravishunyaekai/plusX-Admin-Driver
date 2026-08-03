-- Offline EV Roadside Assistance tables

CREATE TABLE IF NOT EXISTS rsa_offline_booking (
    id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
    request_id           VARCHAR(50)  NOT NULL,
    rider_id             VARCHAR(50)  NULL DEFAULT NULL,
    customer_name        VARCHAR(150) NOT NULL,
    mobile_no            VARCHAR(20)  NOT NULL,
    email_id             VARCHAR(150) NOT NULL,
    location_link        TEXT         NULL,
    address              TEXT         NOT NULL,
    price                DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    jump_start_required  ENUM('Yes', 'No') NOT NULL DEFAULT 'No',
    battery_level        INT          NULL DEFAULT 0,
    vehicle_data         VARCHAR(255) NULL COMMENT 'Vehicle make and model',
    booking_price        DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    order_status         VARCHAR(20)  NOT NULL DEFAULT 'CNF',
    payment_status       VARCHAR(50)  NULL DEFAULT 'Pending',
    transaction_id       VARCHAR(100) NULL,
    created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_rsa_offline_booking_request_id (request_id),
    KEY idx_rsa_offline_booking_rider_id (rider_id),
    KEY idx_rsa_offline_booking_mobile_no (mobile_no),
    KEY idx_rsa_offline_booking_order_status (order_status),
    KEY idx_rsa_offline_booking_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rsa_offline_order_history (
    id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
    order_id      VARCHAR(50)  NOT NULL,
    rider_id      VARCHAR(50)  NULL DEFAULT NULL,
    driver_name   VARCHAR(150) NULL,
    order_status  VARCHAR(20)  NOT NULL,
    remarks       TEXT         NULL,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_rsa_offline_history_order_id (order_id),
    KEY idx_rsa_offline_history_rider_id (rider_id),
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

-- If tables already exist without rider_id, run:
-- ALTER TABLE rsa_offline_booking ADD COLUMN rider_id VARCHAR(50) NULL DEFAULT NULL AFTER request_id;
-- ALTER TABLE rsa_offline_order_history ADD COLUMN rider_id VARCHAR(50) NULL DEFAULT NULL AFTER order_id;
-- ALTER TABLE rsa_offline_invoice ADD COLUMN rider_id VARCHAR(50) NULL DEFAULT NULL AFTER request_id;
