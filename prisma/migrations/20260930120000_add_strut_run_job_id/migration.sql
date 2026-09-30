-- AlterTable
ALTER TABLE "strut_runs" ADD COLUMN     "job_id" TEXT;

-- CreateIndex
CREATE INDEX "strut_runs_job_id_idx" ON "strut_runs"("job_id");
