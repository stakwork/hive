-- CreateEnum
CREATE TYPE "PoolState" AS ENUM ('NOT_STARTED', 'STARTED', 'FAILED', 'COMPLETE');

-- AlterTable
ALTER TABLE "swarms" ADD COLUMN     "code_ingested" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pool_state" "PoolState" NOT NULL DEFAULT 'NOT_STARTED';
