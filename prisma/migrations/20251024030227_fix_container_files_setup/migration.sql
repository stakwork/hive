-- Fix containerFilesSetUp flag for all existing swarms
-- Set containerFilesSetUp to true for all existing swarms

UPDATE "swarms"
SET "container_files_set_up" = true
WHERE "container_files_set_up" IS NOT true;