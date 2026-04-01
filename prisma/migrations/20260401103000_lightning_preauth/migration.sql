-- AlterTable: make workspace_id nullable and add workspace_name/workspace_slug
ALTER TABLE "lightning_payments" ALTER COLUMN "workspace_id" DROP NOT NULL;
ALTER TABLE "lightning_payments" ADD COLUMN "workspace_name" TEXT;
ALTER TABLE "lightning_payments" ADD COLUMN "workspace_slug" TEXT;
