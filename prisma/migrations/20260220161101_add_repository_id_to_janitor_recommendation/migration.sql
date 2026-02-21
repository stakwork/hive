-- AlterTable
ALTER TABLE "janitor_recommendations" ADD COLUMN     "repository_id" TEXT;

-- CreateIndex
CREATE INDEX "janitor_recommendations_repository_id_idx" ON "janitor_recommendations"("repository_id");

-- AddForeignKey
ALTER TABLE "janitor_recommendations" ADD CONSTRAINT "janitor_recommendations_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: copy repository_id from the parent janitor_run
UPDATE "janitor_recommendations" rec
SET "repository_id" = jr."repository_id"
FROM "janitor_runs" jr
WHERE rec."janitor_run_id" = jr."id"
  AND jr."repository_id" IS NOT NULL
  AND rec."repository_id" IS NULL;
