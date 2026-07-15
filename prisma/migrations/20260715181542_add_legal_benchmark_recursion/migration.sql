-- CreateEnum
CREATE TYPE "RecursionStatus" AS ENUM ('ACTIVE', 'RUNNING', 'INACTIVE');

-- CreateTable
CREATE TABLE "legal_benchmark_recursions" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "task_slug" TEXT NOT NULL,
    "status" "RecursionStatus" NOT NULL DEFAULT 'ACTIVE',
    "run_id" TEXT NOT NULL,
    "last_run_id" TEXT,
    "last_run_at" TIMESTAMP(3),
    "last_score" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legal_benchmark_recursions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "legal_benchmark_recursions_workspace_id_idx" ON "legal_benchmark_recursions"("workspace_id");

-- CreateIndex
CREATE INDEX "legal_benchmark_recursions_status_idx" ON "legal_benchmark_recursions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "legal_benchmark_recursions_workspace_id_task_slug_key" ON "legal_benchmark_recursions"("workspace_id", "task_slug");

-- AddForeignKey
ALTER TABLE "legal_benchmark_recursions" ADD CONSTRAINT "legal_benchmark_recursions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
