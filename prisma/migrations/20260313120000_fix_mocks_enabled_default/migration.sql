-- AlterTable: fix mocks_enabled default from true to false
ALTER TABLE "repositories" ALTER COLUMN "mocks_enabled" SET DEFAULT false;
