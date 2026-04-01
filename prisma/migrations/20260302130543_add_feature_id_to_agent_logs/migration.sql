-- AlterTable
ALTER TABLE "agent_logs" ADD COLUMN     "feature_id" TEXT;

-- CreateIndex
CREATE INDEX "agent_logs_feature_id_idx" ON "agent_logs"("feature_id");

-- AddForeignKey
ALTER TABLE "agent_logs" ADD CONSTRAINT "agent_logs_feature_id_fkey" FOREIGN KEY ("feature_id") REFERENCES "features"("id") ON DELETE SET NULL ON UPDATE CASCADE;
