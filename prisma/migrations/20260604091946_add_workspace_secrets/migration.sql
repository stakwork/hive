-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "stakwork_customer_id" TEXT;

-- CreateTable
CREATE TABLE "workspace_secrets" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "encrypted_value" TEXT NOT NULL,
    "description" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_secrets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workspace_secrets_workspace_id_idx" ON "workspace_secrets"("workspace_id");

-- AddForeignKey
ALTER TABLE "workspace_secrets" ADD CONSTRAINT "workspace_secrets_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_secrets" ADD CONSTRAINT "workspace_secrets_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
