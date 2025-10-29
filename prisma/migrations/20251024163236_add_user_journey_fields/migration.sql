-- AlterEnum
ALTER TYPE "TaskSourceType" ADD VALUE 'USER_JOURNEY';

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "test_file_path" TEXT,
ADD COLUMN     "test_file_url" TEXT;
