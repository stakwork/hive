-- CreateTable
CREATE TABLE "diagrams" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "description" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "diagrams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diagram_workspaces" (
    "id" TEXT NOT NULL,
    "diagram_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,

    CONSTRAINT "diagram_workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "diagram_workspaces_workspace_id_idx" ON "diagram_workspaces"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "diagram_workspaces_diagram_id_workspace_id_key" ON "diagram_workspaces"("diagram_id", "workspace_id");

-- AddForeignKey
ALTER TABLE "diagram_workspaces" ADD CONSTRAINT "diagram_workspaces_diagram_id_fkey" FOREIGN KEY ("diagram_id") REFERENCES "diagrams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagram_workspaces" ADD CONSTRAINT "diagram_workspaces_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
