-- AlterTable
ALTER TABLE "artifacts" ADD COLUMN     "artifact_icon" TEXT;

-- CreateIndex
CREATE INDEX "artifacts_artifact_icon_idx" ON "artifacts"("artifact_icon");
