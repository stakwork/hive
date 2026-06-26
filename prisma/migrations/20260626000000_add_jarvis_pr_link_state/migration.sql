-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "jarvis_pr_linked_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "tasks_jarvis_pr_linked_at_idx" ON "tasks"("jarvis_pr_linked_at");
