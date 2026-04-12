-- CreateTable
CREATE TABLE "connections" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "diagram" TEXT,
    "open_api_spec" TEXT,
    "prompt" TEXT,
    "created_by" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "connections_org_id_idx" ON "connections"("org_id");

-- AddForeignKey
ALTER TABLE "connections" ADD CONSTRAINT "connections_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "source_control_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
