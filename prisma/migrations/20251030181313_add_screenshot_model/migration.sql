-- CreateTable
CREATE TABLE "screenshots" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "task_id" TEXT,
    "s3_key" TEXT NOT NULL,
    "s3_url" TEXT,
    "url_expires_at" TIMESTAMP(3),
    "action_index" INTEGER NOT NULL,
    "page_url" TEXT NOT NULL,
    "timestamp" BIGINT NOT NULL,
    "hash" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "screenshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "screenshots_s3_key_key" ON "screenshots"("s3_key");

-- CreateIndex
CREATE UNIQUE INDEX "screenshots_hash_key" ON "screenshots"("hash");

-- CreateIndex
CREATE INDEX "screenshots_workspace_id_idx" ON "screenshots"("workspace_id");

-- CreateIndex
CREATE INDEX "screenshots_task_id_idx" ON "screenshots"("task_id");

-- CreateIndex
CREATE INDEX "screenshots_hash_idx" ON "screenshots"("hash");

-- CreateIndex
CREATE INDEX "screenshots_page_url_idx" ON "screenshots"("page_url");

-- CreateIndex
CREATE INDEX "screenshots_created_at_idx" ON "screenshots"("created_at");

-- AddForeignKey
ALTER TABLE "screenshots" ADD CONSTRAINT "screenshots_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screenshots" ADD CONSTRAINT "screenshots_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
