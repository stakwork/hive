-- AlterTable
ALTER TABLE "features" ADD COLUMN     "selected_repository_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];
