-- AlterTable
ALTER TABLE "users" ADD COLUMN     "voice_learning_enabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "voice_correction_learnings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "workspace_id" TEXT,
    "surface" TEXT NOT NULL,
    "raw_transcript" TEXT NOT NULL,
    "pre_voice_text" TEXT NOT NULL,
    "final_text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_correction_learnings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "voice_correction_learnings_user_id_idx" ON "voice_correction_learnings"("user_id");

-- CreateIndex
CREATE INDEX "voice_correction_learnings_surface_idx" ON "voice_correction_learnings"("surface");

-- CreateIndex
CREATE INDEX "voice_correction_learnings_created_at_idx" ON "voice_correction_learnings"("created_at");

-- AddForeignKey
ALTER TABLE "voice_correction_learnings" ADD CONSTRAINT "voice_correction_learnings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_correction_learnings" ADD CONSTRAINT "voice_correction_learnings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;
