-- AlterTable
ALTER TABLE "swarms" ADD COLUMN IF NOT EXISTS "bifrost_agents_seed_hash" TEXT;
ALTER TABLE "swarms" ADD COLUMN IF NOT EXISTS "bifrost_agents_seed_at" TIMESTAMP(3);
