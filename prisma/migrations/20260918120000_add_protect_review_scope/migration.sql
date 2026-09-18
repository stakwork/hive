-- CreateTable
CREATE TABLE "protect_review_repos" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "repository_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "protect_review_repos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "protect_review_run_repos" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "repository_id" TEXT NOT NULL,
    "canonical_url" TEXT NOT NULL,

    CONSTRAINT "protect_review_run_repos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "protect_review_repos_workspace_id_idx" ON "protect_review_repos"("workspace_id");

-- CreateIndex
CREATE INDEX "protect_review_repos_repository_id_idx" ON "protect_review_repos"("repository_id");

-- CreateIndex
CREATE UNIQUE INDEX "protect_review_repos_workspace_id_repository_id_key" ON "protect_review_repos"("workspace_id", "repository_id");

-- CreateIndex
CREATE INDEX "protect_review_run_repos_run_id_idx" ON "protect_review_run_repos"("run_id");

-- CreateIndex
CREATE INDEX "protect_review_run_repos_repository_id_idx" ON "protect_review_run_repos"("repository_id");

-- CreateIndex
CREATE INDEX "protect_review_run_repos_canonical_url_idx" ON "protect_review_run_repos"("canonical_url");

-- CreateIndex
CREATE UNIQUE INDEX "protect_review_run_repos_run_id_repository_id_key" ON "protect_review_run_repos"("run_id", "repository_id");

-- AddForeignKey
ALTER TABLE "protect_review_repos" ADD CONSTRAINT "protect_review_repos_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protect_review_repos" ADD CONSTRAINT "protect_review_repos_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protect_review_run_repos" ADD CONSTRAINT "protect_review_run_repos_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "protect_review_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protect_review_run_repos" ADD CONSTRAINT "protect_review_run_repos_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
