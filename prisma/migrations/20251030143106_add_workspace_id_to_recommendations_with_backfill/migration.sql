-- Step 1: Add workspace_id column as nullable and make janitor_run_id nullable
ALTER TABLE "janitor_recommendations"
  ADD COLUMN "workspace_id" TEXT,
  ALTER COLUMN "janitor_run_id" DROP NOT NULL;

-- Step 2: Backfill workspace_id for existing recommendations from their janitor runs
UPDATE "janitor_recommendations"
SET "workspace_id" = (
  SELECT w.id
  FROM "janitor_runs" jr
  JOIN "janitor_configs" jc ON jr.janitor_config_id = jc.id
  JOIN "workspaces" w ON jc.workspace_id = w.id
  WHERE jr.id = "janitor_recommendations"."janitor_run_id"
)
WHERE "janitor_run_id" IS NOT NULL;

-- Step 3: Make workspace_id required now that it's populated
ALTER TABLE "janitor_recommendations"
  ALTER COLUMN "workspace_id" SET NOT NULL;

-- Step 4: Create index for performance
CREATE INDEX "janitor_recommendations_workspace_id_idx" ON "janitor_recommendations"("workspace_id");

-- Step 5: Add foreign key constraint
ALTER TABLE "janitor_recommendations"
  ADD CONSTRAINT "janitor_recommendations_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
