-- CreateEnum
CREATE TYPE "NotificationTriggerType" AS ENUM ('PLAN_AWAITING_CLARIFICATION', 'PLAN_AWAITING_APPROVAL', 'PLAN_TASKS_GENERATED', 'GRAPH_CHAT_RESPONSE', 'TASK_PR_MERGED', 'FEATURE_ASSIGNED', 'TASK_ASSIGNED', 'FEATURE_COMPLETED', 'FEATURE_DEPLOYED_PRODUCTION', 'WORKFLOW_HALTED');

-- CreateEnum
CREATE TYPE "NotificationTriggerStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationMethod" AS ENUM ('SPHINX');

-- CreateTable
CREATE TABLE "notification_triggers" (
    "id" TEXT NOT NULL,
    "target_user_id" TEXT NOT NULL,
    "originating_user_id" TEXT,
    "task_id" TEXT,
    "feature_id" TEXT,
    "notification_type" "NotificationTriggerType" NOT NULL,
    "status" "NotificationTriggerStatus" NOT NULL DEFAULT 'PENDING',
    "notification_method" "NotificationMethod" NOT NULL,
    "notification_timestamps" TIMESTAMP(3)[] DEFAULT ARRAY[]::TIMESTAMP(3)[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_triggers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_triggers_target_user_id_idx" ON "notification_triggers"("target_user_id");

-- CreateIndex
CREATE INDEX "notification_triggers_status_idx" ON "notification_triggers"("status");

-- CreateIndex
CREATE INDEX "notification_triggers_notification_type_idx" ON "notification_triggers"("notification_type");

-- CreateIndex
CREATE INDEX "notification_triggers_target_user_id_notification_type_stat_idx" ON "notification_triggers"("target_user_id", "notification_type", "status");

-- AddForeignKey
ALTER TABLE "notification_triggers" ADD CONSTRAINT "notification_triggers_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_triggers" ADD CONSTRAINT "notification_triggers_originating_user_id_fkey" FOREIGN KEY ("originating_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_triggers" ADD CONSTRAINT "notification_triggers_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_triggers" ADD CONSTRAINT "notification_triggers_feature_id_fkey" FOREIGN KEY ("feature_id") REFERENCES "features"("id") ON DELETE SET NULL ON UPDATE CASCADE;
