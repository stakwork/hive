-- AlterTable
ALTER TABLE "html_pages" ADD COLUMN "share_ref" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "html_pages_share_ref_key" ON "html_pages"("share_ref");
