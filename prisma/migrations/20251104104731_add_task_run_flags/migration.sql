-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "run_build" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "run_test_suite" BOOLEAN NOT NULL DEFAULT true;
