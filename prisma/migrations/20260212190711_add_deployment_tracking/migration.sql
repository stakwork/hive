-- CreateEnum
CREATE TYPE "DeploymentEnvironment" AS ENUM ('STAGING', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "DeploymentStatus" AS ENUM ('IN_PROGRESS', 'SUCCESS', 'FAILURE', 'ERROR');

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "deployed_to_production_at" TIMESTAMP(3),
ADD COLUMN     "deployed_to_staging_at" TIMESTAMP(3),
ADD COLUMN     "deployment_status" TEXT;

-- CreateTable
CREATE TABLE "deployments" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "repository_id" TEXT,
    "commit_sha" TEXT NOT NULL,
    "pr_url" TEXT,
    "environment" "DeploymentEnvironment" NOT NULL,
    "status" "DeploymentStatus" NOT NULL,
    "deployment_url" TEXT,
    "github_deployment_id" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deployments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deployments_task_id_idx" ON "deployments"("task_id");

-- CreateIndex
CREATE INDEX "deployments_commit_sha_idx" ON "deployments"("commit_sha");

-- CreateIndex
CREATE INDEX "deployments_repository_id_environment_idx" ON "deployments"("repository_id", "environment");

-- CreateIndex
CREATE INDEX "deployments_github_deployment_id_idx" ON "deployments"("github_deployment_id");

-- CreateIndex
CREATE INDEX "tasks_deployment_status_idx" ON "tasks"("deployment_status");

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
