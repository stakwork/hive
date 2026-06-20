-- CreateTable
CREATE TABLE "scorer_description_proposals" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "insight_id" TEXT,
    "user_prompt" TEXT,
    "rationale" TEXT,
    "edits" JSONB NOT NULL,
    "before_preview" TEXT NOT NULL,
    "after_preview" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "applied_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scorer_description_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scorer_description_proposals_workspace_id_idx" ON "scorer_description_proposals"("workspace_id");

-- CreateIndex
CREATE INDEX "scorer_description_proposals_insight_id_idx" ON "scorer_description_proposals"("insight_id");

-- CreateIndex
CREATE INDEX "scorer_description_proposals_status_idx" ON "scorer_description_proposals"("status");

-- AddForeignKey
ALTER TABLE "scorer_description_proposals" ADD CONSTRAINT "scorer_description_proposals_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
