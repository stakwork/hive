-- AlterTable
ALTER TABLE "features" ADD COLUMN     "error_issue_id" TEXT;

-- CreateIndex
CREATE INDEX "features_error_issue_id_idx" ON "features"("error_issue_id");

-- AddForeignKey
ALTER TABLE "features" ADD CONSTRAINT "features_error_issue_id_fkey" FOREIGN KEY ("error_issue_id") REFERENCES "error_issues"("id") ON DELETE SET NULL ON UPDATE CASCADE;
