-- CreateEnum
CREATE TYPE "PodStatus" AS ENUM ('PENDING', 'RUNNING', 'STOPPED', 'FAILED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "PodUsageStatus" AS ENUM ('AVAILABLE', 'IN_USE', 'CLAIMED', 'RESERVED');

-- CreateEnum
CREATE TYPE "PodFlagReason" AS ENUM ('OOM_KILLED', 'CRASH_LOOP', 'IMAGE_PULL_ERROR', 'HEALTH_CHECK_FAILED', 'MANUAL_FLAG', 'STALE');

-- AlterTable
ALTER TABLE "swarms" ADD COLUMN     "minimum_vms" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "webhook_url" TEXT;

-- CreateTable
CREATE TABLE "pods" (
    "id" TEXT NOT NULL,
    "pod_id" TEXT NOT NULL,
    "swarm_id" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "port_mappings" JSONB NOT NULL DEFAULT '{}',
    "status" "PodStatus" NOT NULL DEFAULT 'RUNNING',
    "usage_status" "PodUsageStatus" NOT NULL DEFAULT 'AVAILABLE',
    "last_health_check" TIMESTAMP(3),
    "health_status" TEXT,
    "health_message" TEXT,
    "flagged_for_recreation" BOOLEAN NOT NULL DEFAULT false,
    "flag_reason" "PodFlagReason",
    "flagged_at" TIMESTAMP(3),
    "recreation_attempts" INTEGER NOT NULL DEFAULT 0,
    "current_task_id" TEXT,
    "claimed_at" TIMESTAMP(3),
    "released_at" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pods_pod_id_key" ON "pods"("pod_id");

-- CreateIndex
CREATE INDEX "pods_swarm_id_idx" ON "pods"("swarm_id");

-- CreateIndex
CREATE INDEX "pods_pod_id_idx" ON "pods"("pod_id");

-- CreateIndex
CREATE INDEX "pods_status_idx" ON "pods"("status");

-- CreateIndex
CREATE INDEX "pods_usage_status_idx" ON "pods"("usage_status");

-- CreateIndex
CREATE INDEX "pods_flagged_for_recreation_idx" ON "pods"("flagged_for_recreation");

-- CreateIndex
CREATE INDEX "pods_current_task_id_idx" ON "pods"("current_task_id");

-- AddForeignKey
ALTER TABLE "pods" ADD CONSTRAINT "pods_swarm_id_fkey" FOREIGN KEY ("swarm_id") REFERENCES "swarms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
