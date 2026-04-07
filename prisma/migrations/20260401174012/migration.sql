-- DropForeignKey (safe: operates on whichever table name exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'swarm_payments') THEN
    ALTER TABLE "swarm_payments" DROP CONSTRAINT IF EXISTS "swarm_payments_workspace_id_fkey";
    ALTER TABLE "swarm_payments" ADD CONSTRAINT "swarm_payments_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
