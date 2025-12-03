-- AlterEnum
-- This migration updates the FeaturePriority enum to match the Priority enum used by tasks
-- Changes:
--   - Remove NONE (will be converted to LOW)
--   - Replace URGENT with CRITICAL

-- Step 1: Update existing data - convert NONE to LOW and URGENT to CRITICAL
UPDATE features SET priority = 'LOW' WHERE priority = 'NONE';
UPDATE features SET priority = 'CRITICAL' WHERE priority = 'URGENT';

-- Step 2: Create new enum type with updated values
CREATE TYPE "FeaturePriority_new" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- Step 3: Alter the table to use the new enum
ALTER TABLE features ALTER COLUMN priority TYPE "FeaturePriority_new" USING (priority::text::"FeaturePriority_new");

-- Step 4: Drop the old enum and rename the new one
DROP TYPE "FeaturePriority";
ALTER TYPE "FeaturePriority_new" RENAME TO "FeaturePriority";

-- Step 5: Update the default value for priority column
ALTER TABLE features ALTER COLUMN priority SET DEFAULT 'LOW'::"FeaturePriority";
