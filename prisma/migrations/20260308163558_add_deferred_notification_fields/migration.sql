-- AlterEnum
ALTER TYPE "NotificationTriggerStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "notification_triggers" ADD COLUMN "send_after" TIMESTAMP(3);
ALTER TABLE "notification_triggers" ADD COLUMN "message" TEXT;

-- CreateIndex
CREATE INDEX "notification_triggers_send_after_status_idx" ON "notification_triggers"("send_after", "status");
