-- AlterEnum
ALTER TYPE "JanitorType" ADD VALUE 'GENERAL_REFACTORING';

-- AlterTable
ALTER TABLE "janitor_configs" ADD COLUMN     "general_refactoring_enabled" BOOLEAN NOT NULL DEFAULT false;
