-- Community managers table

CREATE TABLE IF NOT EXISTS community_managers (
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
