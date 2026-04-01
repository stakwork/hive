-- CreateEnum
CREATE TYPE "LightningPaymentStatus" AS ENUM ('UNPAID', 'PAID', 'EXPIRED');

-- CreateTable
CREATE TABLE "lightning_payments" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "payment_hash" TEXT NOT NULL,
    "invoice" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "LightningPaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lightning_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lightning_payments_payment_hash_key" ON "lightning_payments"("payment_hash");

-- CreateIndex
CREATE INDEX "lightning_payments_workspace_id_idx" ON "lightning_payments"("workspace_id");

-- CreateIndex
CREATE INDEX "lightning_payments_payment_hash_idx" ON "lightning_payments"("payment_hash");

-- AddForeignKey
ALTER TABLE "lightning_payments" ADD CONSTRAINT "lightning_payments_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
