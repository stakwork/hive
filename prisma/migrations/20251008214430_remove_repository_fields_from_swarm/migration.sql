/*
  Warnings:

  - You are about to drop the column `default_branch` on the `swarms` table. All the data in the column will be lost.
  - You are about to drop the column `repository_description` on the `swarms` table. All the data in the column will be lost.
  - You are about to drop the column `repository_name` on the `swarms` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "swarms" DROP COLUMN "default_branch",
DROP COLUMN "repository_description",
DROP COLUMN "repository_name";
