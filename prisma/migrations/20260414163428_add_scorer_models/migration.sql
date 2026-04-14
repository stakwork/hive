-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "scorer_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "scorer_pattern_prompt" TEXT,
ADD COLUMN     "scorer_single_prompt" TEXT;

-- CreateTable
CREATE TABLE "scorer_digests" (
    "id" TEXT NOT NULL,
    "feature_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scorer_digests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scorer_insights" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "prompt_snapshot" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "feature_ids" TEXT[],
    "suggestion" TEXT NOT NULL,
    "digest_ids" TEXT[],
    "dismissed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scorer_insights_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "scorer_digests_feature_id_key" ON "scorer_digests"("feature_id");

-- CreateIndex
CREATE INDEX "scorer_digests_feature_id_idx" ON "scorer_digests"("feature_id");

-- CreateIndex
CREATE INDEX "scorer_digests_workspace_id_idx" ON "scorer_digests"("workspace_id");

-- CreateIndex
CREATE INDEX "scorer_insights_workspace_id_idx" ON "scorer_insights"("workspace_id");

-- CreateIndex
CREATE INDEX "scorer_insights_severity_idx" ON "scorer_insights"("severity");

-- CreateIndex
CREATE INDEX "scorer_insights_created_at_idx" ON "scorer_insights"("created_at");

-- CreateIndex
CREATE INDEX "scorer_insights_dismissed_at_idx" ON "scorer_insights"("dismissed_at");

-- AddForeignKey
ALTER TABLE "scorer_digests" ADD CONSTRAINT "scorer_digests_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scorer_digests" ADD CONSTRAINT "scorer_digests_feature_id_fkey" FOREIGN KEY ("feature_id") REFERENCES "features"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scorer_insights" ADD CONSTRAINT "scorer_insights_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
