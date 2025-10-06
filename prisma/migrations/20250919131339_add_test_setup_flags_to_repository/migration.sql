-- AlterTable
ALTER TABLE "repositories" ADD COLUMN     "playwright_setup" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "testing_framework_setup" BOOLEAN NOT NULL DEFAULT false;
