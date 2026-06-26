-- AlterEnum
ALTER TYPE "JanitorType" ADD VALUE 'LINGO_EXTRACTION';

-- AlterTable
ALTER TABLE "janitor_configs" ADD COLUMN     "lingo_extraction_enabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "lingo_extraction_state" JSONB NOT NULL DEFAULT '{}';
