-- CreateEnum
CREATE TYPE "JanitorType" AS ENUM ('UNIT_TESTS', 'INTEGRATION_TESTS');

-- CreateEnum
CREATE TYPE "JanitorStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JanitorTrigger" AS ENUM ('MANUAL', 'SCHEDULED', 'WEBHOOK', 'ON_COMMIT');

-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DISMISSED', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "TaskSourceType" AS ENUM ('USER', 'JANITOR', 'SYSTEM');

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "source_type" "TaskSourceType" NOT NULL DEFAULT 'USER';

-- CreateTable
CREATE TABLE "janitor_configs" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "unit_tests_enabled" BOOLEAN NOT NULL DEFAULT false,
    "integration_tests_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "janitor_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "janitor_runs" (
    "id" TEXT NOT NULL,
    "janitor_config_id" TEXT NOT NULL,
    "janitor_type" "JanitorType" NOT NULL,
    "status" "JanitorStatus" NOT NULL DEFAULT 'PENDING',
    "triggered_by" "JanitorTrigger" NOT NULL DEFAULT 'SCHEDULED',
    "stakwork_project_id" INTEGER,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "error" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "janitor_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "janitor_recommendations" (
    "id" TEXT NOT NULL,
    "janitor_run_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "impact" TEXT,
    "status" "RecommendationStatus" NOT NULL DEFAULT 'PENDING',
    "accepted_at" TIMESTAMP(3),
    "dismissed_at" TIMESTAMP(3),
    "accepted_by_id" TEXT,
    "dismissed_by_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "janitor_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "janitor_configs_workspace_id_key" ON "janitor_configs"("workspace_id");

-- CreateIndex
CREATE INDEX "janitor_configs_workspace_id_idx" ON "janitor_configs"("workspace_id");

-- CreateIndex
CREATE INDEX "janitor_runs_janitor_config_id_idx" ON "janitor_runs"("janitor_config_id");

-- CreateIndex
CREATE INDEX "janitor_runs_janitor_type_idx" ON "janitor_runs"("janitor_type");

-- CreateIndex
CREATE INDEX "janitor_runs_status_idx" ON "janitor_runs"("status");

-- CreateIndex
CREATE INDEX "janitor_runs_created_at_idx" ON "janitor_runs"("created_at");

-- CreateIndex
CREATE INDEX "janitor_recommendations_janitor_run_id_idx" ON "janitor_recommendations"("janitor_run_id");

-- CreateIndex
CREATE INDEX "janitor_recommendations_status_idx" ON "janitor_recommendations"("status");

-- CreateIndex
CREATE INDEX "janitor_recommendations_priority_idx" ON "janitor_recommendations"("priority");

-- CreateIndex
CREATE INDEX "janitor_recommendations_created_at_idx" ON "janitor_recommendations"("created_at");

-- AddForeignKey
ALTER TABLE "janitor_configs" ADD CONSTRAINT "janitor_configs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "janitor_runs" ADD CONSTRAINT "janitor_runs_janitor_config_id_fkey" FOREIGN KEY ("janitor_config_id") REFERENCES "janitor_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "janitor_recommendations" ADD CONSTRAINT "janitor_recommendations_janitor_run_id_fkey" FOREIGN KEY ("janitor_run_id") REFERENCES "janitor_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "janitor_recommendations" ADD CONSTRAINT "janitor_recommendations_accepted_by_id_fkey" FOREIGN KEY ("accepted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "janitor_recommendations" ADD CONSTRAINT "janitor_recommendations_dismissed_by_id_fkey" FOREIGN KEY ("dismissed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
