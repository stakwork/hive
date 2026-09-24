-- CreateTable
CREATE TABLE "org_api_keys" (
    "id" TEXT NOT NULL,
    "source_control_org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoked_by_id" TEXT,

    CONSTRAINT "org_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "org_api_keys_key_hash_key" ON "org_api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "org_api_keys_source_control_org_id_idx" ON "org_api_keys"("source_control_org_id");

-- CreateIndex
CREATE INDEX "org_api_keys_created_by_id_idx" ON "org_api_keys"("created_by_id");

-- AddForeignKey
ALTER TABLE "org_api_keys" ADD CONSTRAINT "org_api_keys_source_control_org_id_fkey" FOREIGN KEY ("source_control_org_id") REFERENCES "source_control_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_api_keys" ADD CONSTRAINT "org_api_keys_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_api_keys" ADD CONSTRAINT "org_api_keys_revoked_by_id_fkey" FOREIGN KEY ("revoked_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "swarms" ADD COLUMN "strut_hive_key_id" TEXT;
