/*
  Warnings:

  - You are about to drop the column `feature_id` on the `tasks` table. All the data in the column will be lost.
  - You are about to drop the column `user_story_id` on the `tasks` table. All the data in the column will be lost.
  - Added the required column `workspace_id` to the `tasks` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_feature_id_fkey";

-- DropForeignKey
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_user_story_id_fkey";

-- DropIndex
DROP INDEX "tasks_feature_id_idx";

-- DropIndex
DROP INDEX "tasks_user_story_id_idx";

-- AlterTable
ALTER TABLE "tasks" DROP COLUMN "feature_id",
DROP COLUMN "user_story_id",
ADD COLUMN     "workspace_id" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "tasks_workspace_id_idx" ON "tasks"("workspace_id");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
