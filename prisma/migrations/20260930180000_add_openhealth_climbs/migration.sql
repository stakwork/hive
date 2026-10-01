-- CreateEnum
CREATE TYPE "OpenHealthClimbStatus" AS ENUM ('RUNNING', 'REACHED', 'EXHAUSTED', 'STALLED', 'STOPPED', 'FAILED');

-- AlterTable
ALTER TABLE "strut_runs" ADD COLUMN     "climb_id" TEXT;

-- CreateTable
CREATE TABLE "openhealth_climbs" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "swarm_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "gt_id" INTEGER NOT NULL,
    "target_f1" DOUBLE PRECISION NOT NULL,
    "max_attempts" INTEGER NOT NULL,
    "status" "OpenHealthClimbStatus" NOT NULL DEFAULT 'RUNNING',
    "stop_reason" TEXT,
    "seed_run_id" TEXT,
    "current_run_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "start_f1" DOUBLE PRECISION,
    "best_f1" DOUBLE PRECISION,
    "public_base_url" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "openhealth_climbs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "openhealth_climbs_workspace_id_gt_id_created_at_idx" ON "openhealth_climbs"("workspace_id", "gt_id", "created_at");

-- CreateIndex
CREATE INDEX "openhealth_climbs_status_updated_at_idx" ON "openhealth_climbs"("status", "updated_at");

-- CreateIndex
CREATE INDEX "strut_runs_climb_id_idx" ON "strut_runs"("climb_id");

