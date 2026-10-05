-- AlterTable
ALTER TABLE "repositories" ADD COLUMN     "pending_auto_learn_at" TIMESTAMP(3),
ADD COLUMN     "pending_auto_learn_request_id" TEXT;
