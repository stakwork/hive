-- AlterTable: make workspace_id nullable and add workspace_name/workspace_slug (safe: skip if table already renamed)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'swarm_payments') THEN
    ALTER TABLE "swarm_payments" ALTER COLUMN "workspace_id" DROP NOT NULL;
    ALTER TABLE "swarm_payments" ADD COLUMN IF NOT EXISTS "workspace_name" TEXT;
    ALTER TABLE "swarm_payments" ADD COLUMN IF NOT EXISTS "workspace_slug" TEXT;
  END IF;
END $$;
