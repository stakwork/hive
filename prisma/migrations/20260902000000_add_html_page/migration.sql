-- AlterEnum
ALTER TYPE "ArtifactType" ADD VALUE 'HTML';

-- CreateTable
CREATE TABLE "html_pages" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "s3_key" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "content_type" TEXT NOT NULL DEFAULT 'text/html; charset=utf-8',
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "org_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "html_pages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "html_pages_org_id_idx" ON "html_pages"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "html_pages_org_id_slug_key" ON "html_pages"("org_id", "slug");

-- AddForeignKey
ALTER TABLE "html_pages" ADD CONSTRAINT "html_pages_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "source_control_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
