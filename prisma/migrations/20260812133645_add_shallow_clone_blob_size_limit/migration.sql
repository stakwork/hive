-- AlterTable
ALTER TABLE "repositories" ADD COLUMN     "blob_size_limit" TEXT,
ADD COLUMN     "shallow_clone" BOOLEAN NOT NULL DEFAULT false;
