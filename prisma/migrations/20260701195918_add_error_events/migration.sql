-- CreateEnum
CREATE TYPE "ErrorIssueStatus" AS ENUM ('UNRESOLVED', 'RESOLVED', 'IGNORED');

-- CreateTable
CREATE TABLE "error_issues" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "repository_id" TEXT,
    "repo_key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "exception_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ErrorIssueStatus" NOT NULL DEFAULT 'UNRESOLVED',
    "occurrence_count" INTEGER NOT NULL DEFAULT 1,
    "first_seen_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "environment" TEXT,
    "release" TEXT,
    "metadata" JSONB,
    "kg_ref_id" TEXT,

    CONSTRAINT "error_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "error_events" (
    "id" TEXT NOT NULL,
    "issue_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "repository_id" TEXT,
    "repo_key" TEXT NOT NULL,
    "blob_url" TEXT NOT NULL,
    "exception_type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "environment" TEXT,
    "release" TEXT,
    "request_context" JSONB,
    "metadata" JSONB,
    "fingerprint" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "error_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "error_issues_workspace_id_idx" ON "error_issues"("workspace_id");

-- CreateIndex
CREATE INDEX "error_issues_repository_id_idx" ON "error_issues"("repository_id");

-- CreateIndex
CREATE INDEX "error_issues_last_seen_at_idx" ON "error_issues"("last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "error_issues_workspace_id_repo_key_fingerprint_key" ON "error_issues"("workspace_id", "repo_key", "fingerprint");

-- CreateIndex
CREATE INDEX "error_events_issue_id_idx" ON "error_events"("issue_id");

-- CreateIndex
CREATE INDEX "error_events_workspace_id_idx" ON "error_events"("workspace_id");

-- CreateIndex
CREATE INDEX "error_events_repository_id_idx" ON "error_events"("repository_id");

-- CreateIndex
CREATE INDEX "error_events_created_at_idx" ON "error_events"("created_at");

-- AddForeignKey
ALTER TABLE "error_issues" ADD CONSTRAINT "error_issues_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "error_issues" ADD CONSTRAINT "error_issues_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "error_events" ADD CONSTRAINT "error_events_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "error_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "error_events" ADD CONSTRAINT "error_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "error_events" ADD CONSTRAINT "error_events_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
