-- CreateIndex
-- Partial unique index scoped to active records (PENDING + FAILED) only.
-- Prisma does not natively support partial unique indexes, so this lives
-- exclusively in the migration SQL; the schema.prisma has a matching @@index
-- annotation for documentation purposes.
CREATE UNIQUE INDEX "notification_triggers_active_unique_idx"
  ON "notification_triggers" ("target_user_id", "notification_type", "task_id", "feature_id")
  WHERE status IN ('PENDING', 'FAILED');
