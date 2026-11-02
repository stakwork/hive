-- AlterTable
ALTER TABLE "users" ADD COLUMN     "lightning_pubkey_hash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_lightning_pubkey_hash_key" ON "users"("lightning_pubkey_hash");

