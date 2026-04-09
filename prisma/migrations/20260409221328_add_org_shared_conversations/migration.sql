-- AlterTable
ALTER TABLE "shared_conversations" ADD COLUMN     "source_control_org_id" TEXT,
ALTER COLUMN "workspace_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "shared_conversations_source_control_org_id_idx" ON "shared_conversations"("source_control_org_id");

-- AddForeignKey
ALTER TABLE "shared_conversations" ADD CONSTRAINT "shared_conversations_source_control_org_id_fkey" FOREIGN KEY ("source_control_org_id") REFERENCES "source_control_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
