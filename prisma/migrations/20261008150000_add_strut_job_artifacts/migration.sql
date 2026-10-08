-- CreateTable
CREATE TABLE "strut_job_artifacts" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "swarm_id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "artifact_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "pending_event" TEXT,
    "pending_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "strut_job_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "strut_job_artifacts_job_id_artifact_id_key" ON "strut_job_artifacts"("job_id", "artifact_id");

-- CreateIndex
CREATE INDEX "strut_job_artifacts_workspace_id_url_idx" ON "strut_job_artifacts"("workspace_id", "url");

-- CreateIndex
CREATE INDEX "strut_job_artifacts_job_id_pending_at_idx" ON "strut_job_artifacts"("job_id", "pending_at");
