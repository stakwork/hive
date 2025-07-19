/*
  Warnings:

  - You are about to drop the column `workspace_uuid` on the `chat_messages` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "chat_messages" DROP COLUMN "workspace_uuid";
