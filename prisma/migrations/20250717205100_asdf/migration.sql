-- CreateEnum
CREATE TYPE "ChatRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "ChatStatus" AS ENUM ('SENDING', 'SENT', 'ERROR');

-- CreateEnum
CREATE TYPE "ContextTagType" AS ENUM ('PRODUCT_BRIEF', 'FEATURE_BRIEF', 'SCHEMATIC');

-- CreateEnum
CREATE TYPE "ArtifactType" AS ENUM ('FORM', 'CODE', 'BROWSER', 'IDE', 'MEDIA', 'STREAM');

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "task_id" TEXT,
    "message" TEXT NOT NULL,
    "role" "ChatRole" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contextTags" JSONB NOT NULL DEFAULT '[]',
    "status" "ChatStatus" NOT NULL DEFAULT 'SENDING',
    "source_websocket_id" TEXT,
    "workspace_uuid" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artifacts" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "type" "ArtifactType" NOT NULL,
    "content" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_messages_task_id_idx" ON "chat_messages"("task_id");

-- CreateIndex
CREATE INDEX "chat_messages_timestamp_idx" ON "chat_messages"("timestamp");

-- CreateIndex
CREATE INDEX "artifacts_message_id_idx" ON "artifacts"("message_id");

-- CreateIndex
CREATE INDEX "artifacts_type_idx" ON "artifacts"("type");

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
