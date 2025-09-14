-- AlterEnum
ALTER TYPE "JanitorType" ADD VALUE 'SECURITY_REVIEW';

-- AlterTable
ALTER TABLE "janitor_configs" ADD COLUMN     "security_review_enabled" BOOLEAN NOT NULL DEFAULT false;
