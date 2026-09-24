-- CreateEnum
CREATE TYPE "StrutRunStatus" AS ENUM ('PENDING', 'SUCCESS', 'ERROR', 'CANCELLED', 'LOST');

-- CreateTable
CREATE TABLE "strut_runs" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "swarm_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "workflow" TEXT NOT NULL,
    "strut_run_id" TEXT,
    "status" "StrutRunStatus" NOT NULL DEFAULT 'PENDING',
    "input" JSONB,
    "output" JSONB,
    "error" TEXT,
    "duration_ms" INTEGER,
    "conversation_id" TEXT,
    "proposal_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "strut_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "strut_runs_status_created_at_idx" ON "strut_runs"("status", "created_at");

-- CreateIndex
CREATE INDEX "strut_runs_proposal_id_idx" ON "strut_runs"("proposal_id");

-- CreateIndex
CREATE INDEX "strut_runs_conversation_id_idx" ON "strut_runs"("conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "strut_runs_swarm_id_workflow_strut_run_id_key" ON "strut_runs"("swarm_id", "workflow", "strut_run_id");
