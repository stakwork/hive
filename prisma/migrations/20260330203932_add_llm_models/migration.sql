-- CreateEnum
CREATE TYPE "LlmProvider" AS ENUM ('GOOGLE', 'ANTHROPIC', 'OPENAI', 'AWS_BEDROCK', 'OTHER');

-- CreateTable
CREATE TABLE "llm_models" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" "LlmProvider" NOT NULL,
    "provider_label" TEXT,
    "input_price_per_1m" DOUBLE PRECISION NOT NULL,
    "output_price_per_1m" DOUBLE PRECISION NOT NULL,
    "date_start" TIMESTAMP(3),
    "date_end" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "llm_models_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "llm_models_provider_idx" ON "llm_models"("provider");
