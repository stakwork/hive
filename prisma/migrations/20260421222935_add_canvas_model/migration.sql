-- CreateTable
CREATE TABLE "canvases" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canvases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "canvases_org_id_idx" ON "canvases"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "canvases_org_id_ref_key" ON "canvases"("org_id", "ref");

-- AddForeignKey
ALTER TABLE "canvases" ADD CONSTRAINT "canvases_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "source_control_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
