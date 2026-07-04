-- CreateTable
CREATE TABLE "prompt_daily_runs" (
    "id" TEXT NOT NULL,
    "prompt_id" TEXT NOT NULL,
    "version_id" TEXT,
    "stakwork_prompt_id" INTEGER,
    "stakwork_version_id" INTEGER,
    "workflow_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "run_date" DATE NOT NULL,
    "run_count" INTEGER NOT NULL,
    "hive_version_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompt_daily_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prompt_daily_runs_prompt_id_run_date_idx" ON "prompt_daily_runs"("prompt_id", "run_date");

-- CreateIndex
CREATE INDEX "prompt_daily_runs_hive_version_id_idx" ON "prompt_daily_runs"("hive_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_daily_runs_prompt_id_version_id_run_date_key" ON "prompt_daily_runs"("prompt_id", "version_id", "run_date");

-- AddForeignKey
ALTER TABLE "prompt_daily_runs" ADD CONSTRAINT "prompt_daily_runs_prompt_id_fkey" FOREIGN KEY ("prompt_id") REFERENCES "prompts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_daily_runs" ADD CONSTRAINT "prompt_daily_runs_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "prompt_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
