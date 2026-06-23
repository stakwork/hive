-- AlterTable
ALTER TABLE "source_control_orgs" ADD COLUMN "default_workspace_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "source_control_orgs_default_workspace_id_key" ON "source_control_orgs"("default_workspace_id");

-- AddForeignKey
ALTER TABLE "source_control_orgs" ADD CONSTRAINT "source_control_orgs_default_workspace_id_fkey" FOREIGN KEY ("default_workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;
