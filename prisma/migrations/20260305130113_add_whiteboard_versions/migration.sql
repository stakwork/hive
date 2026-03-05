-- CreateTable
CREATE TABLE "whiteboard_versions" (
    "id" TEXT NOT NULL,
    "whiteboard_id" TEXT NOT NULL,
    "elements" JSONB NOT NULL DEFAULT '[]',
    "app_state" JSONB NOT NULL DEFAULT '{}',
    "files" JSONB NOT NULL DEFAULT '{}',
    "label" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whiteboard_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whiteboard_versions_whiteboard_id_created_at_idx" ON "whiteboard_versions"("whiteboard_id", "created_at");

-- AddForeignKey
ALTER TABLE "whiteboard_versions" ADD CONSTRAINT "whiteboard_versions_whiteboard_id_fkey" FOREIGN KEY ("whiteboard_id") REFERENCES "whiteboards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
