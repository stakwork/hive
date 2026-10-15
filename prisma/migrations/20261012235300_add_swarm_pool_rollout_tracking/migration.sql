-- AlterTable
ALTER TABLE "swarms" ADD COLUMN     "pool_change_id" TEXT,
ADD COLUMN     "pool_change_requested_at" TIMESTAMP(3),
ADD COLUMN     "pool_pushed_at" TIMESTAMP(3),
ADD COLUMN     "pool_push_error" TEXT;
