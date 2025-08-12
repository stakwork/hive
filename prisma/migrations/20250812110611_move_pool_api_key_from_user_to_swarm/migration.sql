/*
  Warnings:

  - You are about to drop the column `pool_api_key` on the `users` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "swarms" ADD COLUMN     "pool_api_key" TEXT;

-- AlterTable
ALTER TABLE "users" DROP COLUMN "pool_api_key";
