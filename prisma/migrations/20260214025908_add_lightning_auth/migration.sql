-- AlterTable
ALTER TABLE "users" ADD COLUMN "lightning_pubkey" TEXT;

-- CreateTable
CREATE TABLE "sphinx_challenges" (
    "id" TEXT NOT NULL,
    "k1" TEXT NOT NULL,
    "pubkey" TEXT,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sphinx_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_lightning_pubkey_key" ON "users"("lightning_pubkey");

-- CreateIndex
CREATE UNIQUE INDEX "sphinx_challenges_k1_key" ON "sphinx_challenges"("k1");

-- CreateIndex
CREATE INDEX "sphinx_challenges_k1_idx" ON "sphinx_challenges"("k1");

-- CreateIndex
CREATE INDEX "sphinx_challenges_expires_at_idx" ON "sphinx_challenges"("expires_at");
