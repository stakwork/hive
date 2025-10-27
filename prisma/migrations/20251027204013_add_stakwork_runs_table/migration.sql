-- CreateEnum
CREATE TYPE "StakworkRunType" AS ENUM ('ARCHITECTURE');

-- CreateEnum
CREATE TYPE "StakworkRunDecision" AS ENUM ('ACCEPTED', 'REJECTED', 'FEEDBACK');

-- CreateTable
CREATE TABLE "stakwork_runs" (
    "id" TEXT NOT NULL,
    "webhook_url" TEXT NOT NULL,
    "project_id" INTEGER,
    "type" "StakworkRunType" NOT NULL,
    "feature_id" TEXT,
    "workspace_id" TEXT NOT NULL,
    "status" "WorkflowStatus" NOT NULL DEFAULT 'PENDING',
    "result" TEXT,
    "data_type" TEXT NOT NULL DEFAULT 'string',
    "feedback" TEXT,
    "decision" "StakworkRunDecision",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stakwork_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stakwork_runs_workspace_id_idx" ON "stakwork_runs"("workspace_id");

-- CreateIndex
CREATE INDEX "stakwork_runs_feature_id_idx" ON "stakwork_runs"("feature_id");

-- CreateIndex
CREATE INDEX "stakwork_runs_type_idx" ON "stakwork_runs"("type");

-- CreateIndex
CREATE INDEX "stakwork_runs_status_idx" ON "stakwork_runs"("status");

-- CreateIndex
CREATE INDEX "stakwork_runs_project_id_idx" ON "stakwork_runs"("project_id");

-- CreateIndex
CREATE INDEX "stakwork_runs_created_at_idx" ON "stakwork_runs"("created_at");

-- AddForeignKey
ALTER TABLE "stakwork_runs" ADD CONSTRAINT "stakwork_runs_feature_id_fkey" FOREIGN KEY ("feature_id") REFERENCES "features"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stakwork_runs" ADD CONSTRAINT "stakwork_runs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
