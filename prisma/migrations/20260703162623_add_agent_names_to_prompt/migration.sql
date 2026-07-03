-- AlterTable
ALTER TABLE "prompts" ADD COLUMN     "agent_names" TEXT[] DEFAULT ARRAY[]::TEXT[];
