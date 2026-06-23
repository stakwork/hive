-- GIN index for Feature.dependsOnFeatureIds (array containment queries)
-- Prisma DSL does not support USING GIN so this is a raw SQL-only migration.
-- Required to activate the BLOCKED_BY_FEATURE reverse edge in the pg-neighbors
-- registry (registry entry carries requiresMigration: true until this index is
-- confirmed deployed).
CREATE INDEX "features_depends_on_feature_ids_gin_idx"
  ON "features" USING GIN ("depends_on_feature_ids");
