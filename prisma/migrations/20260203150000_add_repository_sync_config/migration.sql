-- AlterTable
ALTER TABLE "repositories" ADD COLUMN "code_ingestion_enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "repositories" ADD COLUMN "docs_enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "repositories" ADD COLUMN "mocks_enabled" BOOLEAN NOT NULL DEFAULT false;
