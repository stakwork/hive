/*
  Warnings:

  - You are about to drop the `legal_benchmark_recursions` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "legal_benchmark_recursions" DROP CONSTRAINT "legal_benchmark_recursions_workspace_id_fkey";

-- DropTable
DROP TABLE "legal_benchmark_recursions";
