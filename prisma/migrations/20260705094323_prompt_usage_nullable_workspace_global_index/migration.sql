-- Make workspace_id nullable on prompt_usages to support global (null-workspace) rows
ALTER TABLE "prompt_usages" ALTER COLUMN "workspace_id" DROP NOT NULL;

-- Make the foreign key constraint deferrable-friendly by re-creating it to allow NULLs
-- (Postgres FK constraints already allow NULLs implicitly, so we just drop+re-add
--  to ensure it is not inadvertently constraining null workspace rows)
ALTER TABLE "prompt_usages" DROP CONSTRAINT IF EXISTS "prompt_usages_workspace_id_fkey";
ALTER TABLE "prompt_usages" ADD CONSTRAINT "prompt_usages_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Add partial unique index for global rows (workspace_id IS NULL).
-- The existing composite unique constraint covers per-workspace rows;
-- that constraint does NOT deduplicate NULL workspace rows because Postgres
-- treats NULL != NULL in unique indexes, so we need this explicit partial index.
CREATE UNIQUE INDEX "prompt_usages_global_unique"
  ON "prompt_usages" ("workflow_id", "step_id", "prompt_name")
  WHERE "workspace_id" IS NULL;
