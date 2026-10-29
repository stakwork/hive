-- CreateTable
CREATE TABLE "tribe_links" (
    "id" TEXT NOT NULL,
    "tribe_pubkey" TEXT NOT NULL,
    "tribe_host" TEXT NOT NULL,
    "name" TEXT,
    "org_id" TEXT NOT NULL,
    "workspace_slug" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "cursor" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tribe_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tribe_mentions" (
    "id" TEXT NOT NULL,
    "tribe_link_id" TEXT NOT NULL,
    "mention_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tribe_mentions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tribe_outbox_entries" (
    "id" TEXT NOT NULL,
    "tribe_pubkey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "link" TEXT,
    "text" TEXT,
    "reply_to" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acked_at" TIMESTAMP(3),

    CONSTRAINT "tribe_outbox_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tribe_links_tribe_pubkey_key" ON "tribe_links"("tribe_pubkey");

-- CreateIndex
CREATE INDEX "tribe_links_user_id_idx" ON "tribe_links"("user_id");

-- CreateIndex
CREATE INDEX "tribe_mentions_tribe_link_id_run_id_idx" ON "tribe_mentions"("tribe_link_id", "run_id");

-- CreateIndex
CREATE UNIQUE INDEX "tribe_mentions_tribe_link_id_mention_id_key" ON "tribe_mentions"("tribe_link_id", "mention_id");

-- CreateIndex
CREATE INDEX "tribe_outbox_entries_acked_at_created_at_idx" ON "tribe_outbox_entries"("acked_at", "created_at");

-- CreateIndex
CREATE INDEX "tribe_outbox_entries_tribe_pubkey_kind_created_at_idx" ON "tribe_outbox_entries"("tribe_pubkey", "kind", "created_at");

-- AddForeignKey
ALTER TABLE "tribe_links" ADD CONSTRAINT "tribe_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tribe_links" ADD CONSTRAINT "tribe_links_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "source_control_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tribe_links" ADD CONSTRAINT "tribe_links_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "shared_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tribe_mentions" ADD CONSTRAINT "tribe_mentions_tribe_link_id_fkey" FOREIGN KEY ("tribe_link_id") REFERENCES "tribe_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

