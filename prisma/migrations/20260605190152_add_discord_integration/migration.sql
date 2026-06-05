-- CreateEnum
CREATE TYPE "ChannelStatus" AS ENUM ('ACTIVE', 'ERRORED', 'DISABLED_BY_SYSTEM');

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "discord_bot_token" TEXT,
ADD COLUMN     "discord_client_id" TEXT,
ADD COLUMN     "discord_enabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "discord_channels" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "guild_name" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "channel_name" TEXT NOT NULL,
    "channel_type" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" "ChannelStatus" NOT NULL DEFAULT 'ACTIVE',
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "last_message_id" TEXT,
    "last_synced_at" TIMESTAMP(3),
    "sync_error" TEXT,

    CONSTRAINT "discord_channels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "discord_channels_workspace_id_channel_id_key" ON "discord_channels"("workspace_id", "channel_id");

-- AddForeignKey
ALTER TABLE "discord_channels" ADD CONSTRAINT "discord_channels_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
