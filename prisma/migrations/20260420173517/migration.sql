-- CreateEnum
CREATE TYPE "WorkspaceAccessRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "NotificationTriggerType" ADD VALUE 'WORKSPACE_ACCESS_REQUEST';

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "is_public_viewable" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "workspace_access_requests" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "WorkspaceAccessRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "resolved_by_user_id" TEXT,

    CONSTRAINT "workspace_access_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workspace_access_requests_workspace_id_idx" ON "workspace_access_requests"("workspace_id");

-- CreateIndex
CREATE INDEX "workspace_access_requests_user_id_idx" ON "workspace_access_requests"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_access_requests_workspace_id_user_id_key" ON "workspace_access_requests"("workspace_id", "user_id");

-- AddForeignKey
ALTER TABLE "workspace_access_requests" ADD CONSTRAINT "workspace_access_requests_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_access_requests" ADD CONSTRAINT "workspace_access_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_access_requests" ADD CONSTRAINT "workspace_access_requests_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
