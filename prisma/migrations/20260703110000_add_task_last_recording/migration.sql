-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "last_recording_s3_key" TEXT,
ADD COLUMN     "last_recording_at" TIMESTAMP(3);
