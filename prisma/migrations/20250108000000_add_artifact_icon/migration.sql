-- Add artifact_icon field to artifacts table
ALTER TABLE "artifacts" ADD COLUMN "artifact_icon" TEXT;

-- Add index for artifact_icon for potential querying
CREATE INDEX "artifacts_artifact_icon_idx" ON "artifacts"("artifact_icon");