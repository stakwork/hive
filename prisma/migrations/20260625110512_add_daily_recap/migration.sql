-- AlterEnum
ALTER TYPE "StakworkRunType" ADD VALUE 'DAILY_RECAP';

-- AlterTable
ALTER TABLE "stakwork_runs" ADD COLUMN     "user_id" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "daily_recap_enabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "stakwork_runs_user_id_type_created_at_idx" ON "stakwork_runs"("user_id", "type", "created_at");

-- AddForeignKey
ALTER TABLE "stakwork_runs" ADD CONSTRAINT "stakwork_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
