-- AlterEnum
-- This migration updates the FeaturePriority enum to match the Priority enum used by tasks
-- Changes:
--   - Remove NONE (will be converted to LOW)
--   - Replace URGENT with CRITICAL

-- Step 1: Create a temporary column to store the updated values
ALTER TABLE features ADD COLUMN priority_new TEXT;

-- Step 2: Map old values to new values
UPDATE features SET priority_new = 
  CASE 
    WHEN priority = 'NONE' THEN 'LOW'
    WHEN priority = 'URGENT' THEN 'CRITICAL'
    WHEN priority = 'LOW' THEN 'LOW'
    WHEN priority = 'MEDIUM' THEN 'MEDIUM'
    WHEN priority = 'HIGH' THEN 'HIGH'
  END;

-- Step 3: Create new enum type with updated values
CREATE TYPE "FeaturePriority_new" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- Step 4: Drop the old priority column
ALTER TABLE features DROP COLUMN priority;

-- Step 5: Rename the temp column and set its type to the new enum
ALTER TABLE features RENAME COLUMN priority_new TO priority;
ALTER TABLE features ALTER COLUMN priority TYPE "FeaturePriority_new" USING (priority::"FeaturePriority_new");

-- Step 6: Drop the old enum
DROP TYPE "FeaturePriority";

-- Step 7: Rename the new enum
ALTER TYPE "FeaturePriority_new" RENAME TO "FeaturePriority";

-- Step 8: Set NOT NULL constraint and default value
ALTER TABLE features ALTER COLUMN priority SET NOT NULL;
ALTER TABLE features ALTER COLUMN priority SET DEFAULT 'LOW'::"FeaturePriority";
