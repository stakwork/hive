CREATE TABLE "app_releases" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "booted_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "app_releases_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "app_releases_version_key" ON "app_releases"("version");
