-- Drop existing FK constraint (was ON DELETE CASCADE)
ALTER TABLE "swarm_payments" DROP CONSTRAINT "swarm_payments_workspace_id_fkey";

-- Re-add FK as nullable with SET NULL on delete (no CASCADE)
ALTER TABLE "swarm_payments" ADD CONSTRAINT "swarm_payments_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
