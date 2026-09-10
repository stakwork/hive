-- AlterTable
ALTER TABLE "workspace_members" ADD COLUMN     "bifrost_vk_providers" TEXT[] DEFAULT ARRAY[]::TEXT[];
