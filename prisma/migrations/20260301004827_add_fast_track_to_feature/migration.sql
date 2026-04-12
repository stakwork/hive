-- AlterTable
ALTER TABLE "features" ADD COLUMN IF NOT EXISTS "is_fast_track" BOOLEAN NOT NULL DEFAULT false;
