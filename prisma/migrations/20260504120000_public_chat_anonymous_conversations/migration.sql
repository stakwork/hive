-- Public dashboard chat: allow anonymous (public-viewer) authored conversations
-- and track per-conversation token totals so the rate-limit gate in
-- /api/ask/quick can sum recent spend per visitor.

-- 1. user_id becomes nullable (anonymous public viewers leave it null).
ALTER TABLE "shared_conversations"
  ALTER COLUMN "user_id" DROP NOT NULL;

-- 2. Anonymous visitor identifier — SHA-256(ip + userAgent) truncated.
ALTER TABLE "shared_conversations"
  ADD COLUMN "anonymous_id" TEXT;

-- 3. Running token totals (incremented in onFinish per turn).
ALTER TABLE "shared_conversations"
  ADD COLUMN "input_tokens" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "output_tokens" INTEGER NOT NULL DEFAULT 0;

-- 4. Indexes for the public rate-limit lookups.
CREATE INDEX "shared_conversations_anonymous_id_created_at_idx"
  ON "shared_conversations"("anonymous_id", "created_at");
CREATE INDEX "shared_conversations_workspace_id_anonymous_id_created_at_idx"
  ON "shared_conversations"("workspace_id", "anonymous_id", "created_at");
