-- DropForeignKey
ALTER TABLE "swarm_payments" DROP CONSTRAINT "swarm_payments_workspace_id_fkey";

-- AddForeignKey
ALTER TABLE "swarm_payments" ADD CONSTRAINT "swarm_payments_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
