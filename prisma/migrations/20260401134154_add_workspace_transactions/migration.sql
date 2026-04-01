-- CreateEnum
CREATE TYPE "WorkspaceTransactionType" AS ENUM ('LIGHTNING', 'STRIPE');

-- CreateTable
CREATE TABLE "workspace_transactions" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT,
    "type" "WorkspaceTransactionType" NOT NULL,
    "amount_sats" INTEGER,
    "btc_price_usd" DOUBLE PRECISION,
    "amount_usd" DOUBLE PRECISION,
    "currency" TEXT,
    "lightning_payment_id" TEXT,
    "swarm_payment_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspace_transactions_lightning_payment_id_key" ON "workspace_transactions"("lightning_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_transactions_swarm_payment_id_key" ON "workspace_transactions"("swarm_payment_id");

-- CreateIndex
CREATE INDEX "workspace_transactions_workspace_id_idx" ON "workspace_transactions"("workspace_id");

-- AddForeignKey
ALTER TABLE "workspace_transactions" ADD CONSTRAINT "workspace_transactions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_transactions" ADD CONSTRAINT "workspace_transactions_lightning_payment_id_fkey" FOREIGN KEY ("lightning_payment_id") REFERENCES "lightning_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_transactions" ADD CONSTRAINT "workspace_transactions_swarm_payment_id_fkey" FOREIGN KEY ("swarm_payment_id") REFERENCES "swarm_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
