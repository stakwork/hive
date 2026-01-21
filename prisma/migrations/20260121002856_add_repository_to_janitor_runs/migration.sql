-- AlterTable
ALTER TABLE "janitor_runs" ADD COLUMN     "repository_id" TEXT;

-- CreateIndex
CREATE INDEX "janitor_runs_repository_id_idx" ON "janitor_runs"("repository_id");

-- AddForeignKey
ALTER TABLE "janitor_runs" ADD CONSTRAINT "janitor_runs_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
