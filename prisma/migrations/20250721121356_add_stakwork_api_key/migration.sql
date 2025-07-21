/*
  Warnings:

  - You are about to drop the column `stakworkApiKey` on the `workspaces` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "workspaces" DROP COLUMN "stakworkApiKey",
ADD COLUMN     "stakwork_api_key" TEXT;
