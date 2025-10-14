-- AlterTable
ALTER TABLE "features" ADD COLUMN     "personas" TEXT[] DEFAULT ARRAY[]::TEXT[];
