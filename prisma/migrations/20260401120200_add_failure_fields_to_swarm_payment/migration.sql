-- AlterTable
ALTER TABLE "swarm_payments" ADD COLUMN "failure_code" TEXT;
ALTER TABLE "swarm_payments" ADD COLUMN "failure_message" TEXT;

-- CreateIndex
CREATE INDEX "swarm_payments_stripe_payment_intent_id_idx" ON "swarm_payments"("stripe_payment_intent_id");
