-- AlterTable
ALTER TABLE "whiteboard_messages" ADD COLUMN "metadata" JSONB NOT NULL DEFAULT '{}';
