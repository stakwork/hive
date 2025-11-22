-- AlterTable
ALTER TABLE "workspace_members" ADD COLUMN     "added_by_id" TEXT;

-- CreateIndex
CREATE INDEX "workspace_members_added_by_id_idx" ON "workspace_members"("added_by_id");

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
