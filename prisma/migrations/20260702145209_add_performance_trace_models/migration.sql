-- CreateTable
CREATE TABLE "performance_trace_groups" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "repository_id" TEXT,
    "repo_key" TEXT NOT NULL,
    "transaction_name" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "sample_count" INTEGER NOT NULL DEFAULT 1,
    "p50_ms" DOUBLE PRECISION NOT NULL,
    "p95_ms" DOUBLE PRECISION NOT NULL,
    "p99_ms" DOUBLE PRECISION NOT NULL,
    "throughput" DOUBLE PRECISION NOT NULL,
    "db_time_ms" DOUBLE PRECISION NOT NULL,
    "sketch_state" JSONB NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "performance_trace_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance_trace_events" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "repository_id" TEXT,
    "repo_key" TEXT NOT NULL,
    "blob_url" TEXT NOT NULL,
    "transaction_name" TEXT NOT NULL,
    "total_duration_ms" DOUBLE PRECISION NOT NULL,
    "spans" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "performance_trace_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "performance_trace_groups_workspace_id_idx" ON "performance_trace_groups"("workspace_id");

-- CreateIndex
CREATE INDEX "performance_trace_groups_repository_id_idx" ON "performance_trace_groups"("repository_id");

-- CreateIndex
CREATE INDEX "performance_trace_groups_last_seen_at_idx" ON "performance_trace_groups"("last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "performance_trace_groups_workspace_id_repo_key_signature_key" ON "performance_trace_groups"("workspace_id", "repo_key", "signature");

-- CreateIndex
CREATE INDEX "performance_trace_events_group_id_idx" ON "performance_trace_events"("group_id");

-- CreateIndex
CREATE INDEX "performance_trace_events_workspace_id_idx" ON "performance_trace_events"("workspace_id");

-- CreateIndex
CREATE INDEX "performance_trace_events_repository_id_idx" ON "performance_trace_events"("repository_id");

-- CreateIndex
CREATE INDEX "performance_trace_events_created_at_idx" ON "performance_trace_events"("created_at");

-- AddForeignKey
ALTER TABLE "performance_trace_groups" ADD CONSTRAINT "performance_trace_groups_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_trace_groups" ADD CONSTRAINT "performance_trace_groups_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_trace_events" ADD CONSTRAINT "performance_trace_events_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "performance_trace_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_trace_events" ADD CONSTRAINT "performance_trace_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_trace_events" ADD CONSTRAINT "performance_trace_events_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
