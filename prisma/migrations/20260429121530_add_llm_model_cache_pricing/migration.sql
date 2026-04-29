-- AlterTable
ALTER TABLE "llm_models" ADD COLUMN     "cache_read_per_1m_token" DOUBLE PRECISION,
ADD COLUMN     "cache_write_per_1m_token" DOUBLE PRECISION;
