-- CreateEnum
CREATE TYPE "FindingFixStatus" AS ENUM ('QUEUED', 'RUNNING', 'PR_OPENED', 'FAILED');

-- CreateTable
CREATE TABLE "finding_fixes" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "finding_ref_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "FindingFixStatus" NOT NULL DEFAULT 'QUEUED',
    "repository_url" TEXT NOT NULL,
    "pr_url" TEXT,
    "error" TEXT,
    "stakwork_project_id" INTEGER,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finding_fixes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "finding_fixes_workspace_id_finding_ref_id_idx" ON "finding_fixes"("workspace_id", "finding_ref_id");

-- CreateIndex
CREATE INDEX "finding_fixes_workspace_id_status_idx" ON "finding_fixes"("workspace_id", "status");

-- AddForeignKey
ALTER TABLE "finding_fixes" ADD CONSTRAINT "finding_fixes_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
