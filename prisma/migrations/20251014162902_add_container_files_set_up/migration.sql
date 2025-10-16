-- Add new container_files_set_up column with default false
ALTER TABLE "swarms" ADD COLUMN "container_files_set_up" BOOLEAN NOT NULL DEFAULT false;

-- Update all existing records to have container_files_set_up = true
-- since they already have container files set up
UPDATE "swarms" SET "container_files_set_up" = true;