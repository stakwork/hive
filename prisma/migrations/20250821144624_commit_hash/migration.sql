-- AlterTable
ALTER TABLE "repositories" ADD COLUMN     "commit_hash" TEXT,
ADD COLUMN     "last_commit_date" TIMESTAMP(3);
