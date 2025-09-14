-- AlterTable
ALTER TABLE "accounts" 
ADD COLUMN     "app_access_token" TEXT,
ADD COLUMN     "app_expires_at" INTEGER,
ADD COLUMN     "app_refresh_token" TEXT;
