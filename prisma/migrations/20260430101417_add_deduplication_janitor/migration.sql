-- AlterEnum
ALTER TYPE "JanitorType" ADD VALUE 'DEDUPLICATION';

-- AlterTable
ALTER TABLE "janitor_configs" ADD COLUMN     "deduplication_enabled" BOOLEAN NOT NULL DEFAULT false;
