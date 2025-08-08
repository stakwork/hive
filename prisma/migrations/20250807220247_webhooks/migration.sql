-- AlterTable
ALTER TABLE "repositories" ADD COLUMN     "github_webhook_id" TEXT,
ADD COLUMN     "github_webhook_secret" TEXT;
