-- AlterEnum
ALTER TYPE "StakworkRunType" ADD VALUE 'PROMPT_EVAL';

-- AlterTable
ALTER TABLE "agent_logs" ALTER COLUMN "repos" DROP DEFAULT;

-- AlterTable
ALTER TABLE "stakwork_runs" ADD COLUMN     "eval_set_id" TEXT,
ADD COLUMN     "prompt_version_id" INTEGER;

-- CreateIndex
CREATE INDEX "stakwork_runs_prompt_version_id_idx" ON "stakwork_runs"("prompt_version_id");

-- CreateIndex
CREATE INDEX "stakwork_runs_eval_set_id_idx" ON "stakwork_runs"("eval_set_id");
