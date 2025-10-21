/*
  Warnings:

  - A unique constraint covering the columns `[bounty_code]` on the table `tasks` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "bounty_code" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "tasks_bounty_code_key" ON "tasks"("bounty_code");

-- CreateIndex
CREATE INDEX "tasks_bounty_code_idx" ON "tasks"("bounty_code");
