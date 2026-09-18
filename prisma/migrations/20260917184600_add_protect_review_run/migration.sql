-- CreateEnum
CREATE TYPE "ProtectReviewMode" AS ENUM ('full', 'incremental');

-- CreateEnum
CREATE TYPE "ProtectReviewStatus" AS ENUM ('pending', 'running', 'completed', 'failed');

-- CreateTable
CREATE TABLE "protect_review_runs" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "mode" "ProtectReviewMode" NOT NULL,
    "status" "ProtectReviewStatus" NOT NULL DEFAULT 'pending',
    "repository_url" TEXT,
    "stakwork_project_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "protect_review_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "protect_review_runs_workspace_id_status_idx" ON "protect_review_runs"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "protect_review_runs_workspace_id_mode_status_idx" ON "protect_review_runs"("workspace_id", "mode", "status");

-- AddForeignKey
ALTER TABLE "protect_review_runs" ADD CONSTRAINT "protect_review_runs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
