-- AlterEnum
ALTER TYPE "JanitorType" ADD VALUE 'CONCEPT_REVIEW';

-- AlterTable
ALTER TABLE "janitor_configs" ADD COLUMN     "concept_review_enabled" BOOLEAN NOT NULL DEFAULT false;
