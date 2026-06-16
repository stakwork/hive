-- CreateTable
CREATE TABLE "automations" (
    "id" TEXT NOT NULL,
    "source_control_org_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "time_of_day" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "next_run_at" TIMESTAMP(3) NOT NULL,
    "last_run_at" TIMESTAMP(3),
    "last_run_conversation_id" TEXT,
    "last_run_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "automations_enabled_next_run_at_idx" ON "automations"("enabled", "next_run_at");

-- CreateIndex
CREATE INDEX "automations_source_control_org_id_user_id_idx" ON "automations"("source_control_org_id", "user_id");

-- AddForeignKey
ALTER TABLE "automations" ADD CONSTRAINT "automations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automations" ADD CONSTRAINT "automations_source_control_org_id_fkey" FOREIGN KEY ("source_control_org_id") REFERENCES "source_control_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
