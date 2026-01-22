-- CreateEnum
CREATE TYPE "PodStatus" AS ENUM ('PENDING', 'RUNNING', 'FAILED', 'STOPPED', 'TERMINATING');

-- CreateEnum
CREATE TYPE "PodUsageStatus" AS ENUM ('UNUSED', 'USED');

-- CreateEnum
CREATE TYPE "PodFlagReason" AS ENUM ('POOL_CONFIG_CHANGED', 'HEALTH_CHECK_FAILED', 'MANUAL');

-- AlterTable
ALTER TABLE "swarms" ADD COLUMN     "minimum_vms" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "webhook_url" TEXT;

-- CreateTable
CREATE TABLE "pods" (
    "id" TEXT NOT NULL,
    "pod_id" TEXT NOT NULL,
    "swarm_id" TEXT NOT NULL,
    "password" TEXT,
    "port_mappings" JSONB,
    "status" "PodStatus" NOT NULL DEFAULT 'PENDING',
    "usage_status" "PodUsageStatus" NOT NULL DEFAULT 'UNUSED',
    "usage_status_marked_at" TIMESTAMP(3),
    "usage_status_marked_by" TEXT,
    "usage_status_reason" TEXT,
    "last_health_check" TIMESTAMP(3),
    "flagged_for_recreation" BOOLEAN NOT NULL DEFAULT false,
    "flagged_at" TIMESTAMP(3),
    "flagged_reason" "PodFlagReason",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pods_pod_id_key" ON "pods"("pod_id");

-- CreateIndex
CREATE INDEX "pods_swarm_id_idx" ON "pods"("swarm_id");

-- CreateIndex
CREATE INDEX "pods_status_idx" ON "pods"("status");

-- CreateIndex
CREATE INDEX "pods_usage_status_idx" ON "pods"("usage_status");

-- AddForeignKey
ALTER TABLE "pods" ADD CONSTRAINT "pods_swarm_id_fkey" FOREIGN KEY ("swarm_id") REFERENCES "swarms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
