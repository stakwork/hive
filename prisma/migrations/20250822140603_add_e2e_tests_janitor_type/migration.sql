-- AlterEnum
ALTER TYPE "JanitorType" ADD VALUE 'E2E_TESTS';

-- AlterTable
ALTER TABLE "janitor_configs" ADD COLUMN     "e2e_tests_enabled" BOOLEAN NOT NULL DEFAULT false;
