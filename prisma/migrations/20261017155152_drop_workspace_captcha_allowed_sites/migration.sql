/*
  Warnings:

  - You are about to drop the column `captcha_allowed_sites` on the `workspaces` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "workspaces" DROP COLUMN "captcha_allowed_sites";
