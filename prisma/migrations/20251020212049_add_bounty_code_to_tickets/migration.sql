/*
  Warnings:

  - A unique constraint covering the columns `[bounty_code]` on the table `tickets` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "bounty_code" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "tickets_bounty_code_key" ON "tickets"("bounty_code");

-- CreateIndex
CREATE INDEX "tickets_bounty_code_idx" ON "tickets"("bounty_code");
