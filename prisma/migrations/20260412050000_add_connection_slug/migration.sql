-- AlterTable
ALTER TABLE "connections" ADD COLUMN "slug" TEXT NOT NULL DEFAULT '';

-- Update existing rows to use a generated slug
UPDATE "connections" SET "slug" = "id" WHERE "slug" = '';

-- Remove default
ALTER TABLE "connections" ALTER COLUMN "slug" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "connections_org_id_slug_key" ON "connections"("org_id", "slug");
