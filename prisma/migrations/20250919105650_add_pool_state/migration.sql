-- CreateEnum
CREATE TYPE "PoolState" AS ENUM ('NOT_STARTED', 'STARTED', 'FAILED', 'COMPLETE');

-- AlterTable
ALTER TABLE "swarms" ADD COLUMN     "pool_state" "PoolState" NOT NULL DEFAULT 'NOT_STARTED';
