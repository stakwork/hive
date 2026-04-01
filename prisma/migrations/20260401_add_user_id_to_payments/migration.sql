ALTER TABLE "swarm_payments" ADD COLUMN "user_id" TEXT;
ALTER TABLE "lightning_payments" ADD COLUMN "user_id" TEXT;

ALTER TABLE "swarm_payments"
  ADD CONSTRAINT "swarm_payments_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "lightning_payments"
  ADD CONSTRAINT "lightning_payments_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "swarm_payments_user_id_idx" ON "swarm_payments"("user_id");
CREATE INDEX "lightning_payments_user_id_idx" ON "lightning_payments"("user_id");
