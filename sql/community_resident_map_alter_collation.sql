-- Fix collation mismatch: community_resident_map must match community_list / community_resident
-- (utf8mb4_0900_ai_ci on MySQL 8). Run if you see ER_CANT_AGGREGATE_2COLLATIONS on JOINs.

ALTER TABLE community_resident_map
    MODIFY resident_id  VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
    MODIFY community_id VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL;
