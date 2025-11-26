-- AlterEnum
ALTER TYPE "JanitorType" ADD VALUE 'MOCK_GENERATION';

-- AlterTable
ALTER TABLE "janitor_configs" ADD COLUMN     "mock_generation_enabled" BOOLEAN NOT NULL DEFAULT false;
