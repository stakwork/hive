-- CreateTable
CREATE TABLE "workspace_api_keys" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoked_by_id" TEXT,

    CONSTRAINT "workspace_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspace_api_keys_key_hash_key" ON "workspace_api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "workspace_api_keys_workspace_id_idx" ON "workspace_api_keys"("workspace_id");

-- CreateIndex
CREATE INDEX "workspace_api_keys_key_hash_idx" ON "workspace_api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "workspace_api_keys_created_by_id_idx" ON "workspace_api_keys"("created_by_id");

-- AddForeignKey
ALTER TABLE "workspace_api_keys" ADD CONSTRAINT "workspace_api_keys_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_api_keys" ADD CONSTRAINT "workspace_api_keys_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_api_keys" ADD CONSTRAINT "workspace_api_keys_revoked_by_id_fkey" FOREIGN KEY ("revoked_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
