-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED');

-- CreateEnum
CREATE TYPE "SwarmPaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'EXPIRED');

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "payment_status" "PaymentStatus" NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "swarm_payments" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "stripe_session_id" TEXT NOT NULL,
    "stripe_payment_intent_id" TEXT,
    "status" "SwarmPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount" INTEGER,
    "currency" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "swarm_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "swarm_payments_stripe_session_id_key" ON "swarm_payments"("stripe_session_id");

-- CreateIndex
CREATE INDEX "swarm_payments_workspace_id_idx" ON "swarm_payments"("workspace_id");

-- CreateIndex
CREATE INDEX "swarm_payments_stripe_session_id_idx" ON "swarm_payments"("stripe_session_id");

-- AddForeignKey
ALTER TABLE "swarm_payments" ADD CONSTRAINT "swarm_payments_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
