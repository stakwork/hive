-- AlterTable
ALTER TABLE "prompt_versions" ADD COLUMN     "published_at" TIMESTAMP(3),
ADD COLUMN     "published_by" TEXT;
