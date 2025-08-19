-- CreateEnum
CREATE TYPE "JanitorType" AS ENUM ('UNIT_TESTS', 'INTEGRATION_TESTS');

-- CreateEnum
CREATE TYPE "JanitorStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

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
    "config_id" TEXT NOT NULL,
    "janitor_type" "JanitorType" NOT NULL,
    "status" "JanitorStatus" NOT NULL DEFAULT 'PENDING',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "error" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "janitor_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "janitor_configs_workspace_id_key" ON "janitor_configs"("workspace_id");

-- CreateIndex
CREATE INDEX "janitor_configs_workspace_id_idx" ON "janitor_configs"("workspace_id");

-- CreateIndex
CREATE INDEX "janitor_runs_config_id_idx" ON "janitor_runs"("config_id");

-- CreateIndex
CREATE INDEX "janitor_runs_janitor_type_idx" ON "janitor_runs"("janitor_type");

-- CreateIndex
CREATE INDEX "janitor_runs_status_idx" ON "janitor_runs"("status");

-- AddForeignKey
ALTER TABLE "janitor_configs" ADD CONSTRAINT "janitor_configs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "janitor_runs" ADD CONSTRAINT "janitor_runs_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "janitor_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
