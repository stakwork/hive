-- AlterTable: make workspace_id nullable and add workspace_name/workspace_slug
ALTER TABLE "swarm_payments" ALTER COLUMN "workspace_id" DROP NOT NULL;
ALTER TABLE "swarm_payments" ADD COLUMN "workspace_name" TEXT;
ALTER TABLE "swarm_payments" ADD COLUMN "workspace_slug" TEXT;
