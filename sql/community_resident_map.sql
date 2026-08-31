-- Many-to-many: residents can belong to multiple communities
-- Drops and recreates table with utf8mb4_0900_ai_ci (matches community_list / community_resident on MySQL 8)

DROP TABLE IF EXISTS community_resident_map;

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

-- Backfill from community_resident (single community per resident)
INSERT INTO community_resident_map (resident_id, community_id)
SELECT resident_id, community_id
FROM community_resident
WHERE community_id IS NOT NULL AND community_id != '';
