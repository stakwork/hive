/*
  Warnings:

  - You are about to drop the column `artifact_icon` on the `artifacts` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "artifacts" DROP COLUMN "artifact_icon",
ADD COLUMN     "icon" TEXT;
