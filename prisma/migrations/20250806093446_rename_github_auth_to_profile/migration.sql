-- Rename the github_auth table to github_profiles instead of dropping and recreating it
-- This preserves all existing data

ALTER TABLE "github_auth" DROP CONSTRAINT "github_auth_user_id_fkey";

ALTER TABLE "github_auth" RENAME TO "github_profiles";

ALTER INDEX "github_auth_user_id_key" RENAME TO "github_profiles_user_id_key";
ALTER INDEX "github_auth_github_user_id_idx" RENAME TO "github_profiles_github_user_id_idx";
ALTER INDEX "github_auth_github_username_idx" RENAME TO "github_profiles_github_username_idx";
ALTER TABLE "github_profiles" RENAME CONSTRAINT "github_auth_pkey" TO "github_profiles_pkey";

ALTER TABLE "github_profiles" ADD CONSTRAINT "github_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
