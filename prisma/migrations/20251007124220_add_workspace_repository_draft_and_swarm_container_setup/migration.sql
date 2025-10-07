-- AlterTable
ALTER TABLE "swarms" ADD COLUMN     "container_files_setup" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "repository_draft" TEXT;
