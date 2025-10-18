/*
  Warnings:

  - You are about to drop the column `regex` on the `repositories` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "repositories" DROP COLUMN "regex",
ADD COLUMN     "e2e_glob" TEXT DEFAULT '',
ADD COLUMN     "integration_glob" TEXT DEFAULT '',
ADD COLUMN     "unit_glob" TEXT DEFAULT '';
