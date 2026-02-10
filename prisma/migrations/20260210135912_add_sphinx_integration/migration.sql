-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "sphinx_bot_id" TEXT,
ADD COLUMN     "sphinx_bot_secret" TEXT,
ADD COLUMN     "sphinx_chat_pubkey" TEXT,
ADD COLUMN     "sphinx_enabled" BOOLEAN NOT NULL DEFAULT false;
