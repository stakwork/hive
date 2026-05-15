-- AlterTable
ALTER TABLE "swarms"
  ADD COLUMN "bifrost_admin_user" TEXT,
  ADD COLUMN "bifrost_admin_password" TEXT;

-- AlterTable
ALTER TABLE "workspace_members"
  ADD COLUMN "bifrost_vk_value" TEXT,
  ADD COLUMN "bifrost_vk_id" TEXT,
  ADD COLUMN "bifrost_customer_id" TEXT,
  ADD COLUMN "bifrost_synced_at" TIMESTAMP(3);
