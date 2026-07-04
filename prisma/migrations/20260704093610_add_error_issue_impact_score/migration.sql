-- AlterTable
ALTER TABLE "error_issues" ADD COLUMN     "impact_meta" JSONB,
ADD COLUMN     "impact_score" DOUBLE PRECISION,
ADD COLUMN     "impact_scored_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "error_issues_impact_score_idx" ON "error_issues"("impact_score");
