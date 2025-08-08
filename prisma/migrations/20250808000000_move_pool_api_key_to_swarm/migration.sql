-- Add pool_api_key to swarms
ALTER TABLE "swarms" ADD COLUMN IF NOT EXISTS "pool_api_key" TEXT;

-- Backfill: copy existing user.pool_api_key to related swarms via workspace ownership
UPDATE "swarms" s
SET "pool_api_key" = u."pool_api_key"
FROM "workspaces" w
JOIN "users" u ON w."owner_id" = u."id"
WHERE s."workspace_id" = w."id"
  AND u."pool_api_key" IS NOT NULL
  AND (s."pool_api_key" IS NULL OR s."pool_api_key" = '');

-- Drop pool_api_key from users
ALTER TABLE "users" DROP COLUMN IF EXISTS "pool_api_key";


