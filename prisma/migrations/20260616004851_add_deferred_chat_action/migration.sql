-- CreateEnum
CREATE TYPE "DeferredChatActionStatus" AS ENUM ('PENDING', 'FIRED', 'CANCELLED', 'FAILED');

-- CreateTable
CREATE TABLE "deferred_chat_actions" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "fire_at" TIMESTAMP(3) NOT NULL,
    "status" "DeferredChatActionStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fired_at" TIMESTAMP(3),

    CONSTRAINT "deferred_chat_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deferred_chat_actions_status_fire_at_idx" ON "deferred_chat_actions"("status", "fire_at");
