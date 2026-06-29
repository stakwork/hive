-- DropIndex
DROP INDEX IF EXISTS "features_depends_on_feature_ids_gin_idx";

-- CreateTable
CREATE TABLE "urn_edges" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "from_urn" TEXT NOT NULL,
    "to_urn" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "urn_edges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "urn_edges_from_urn_idx" ON "urn_edges"("from_urn");

-- CreateIndex
CREATE INDEX "urn_edges_to_urn_idx" ON "urn_edges"("to_urn");

-- CreateIndex
CREATE INDEX "urn_edges_org_id_from_urn_idx" ON "urn_edges"("org_id", "from_urn");

-- CreateIndex
CREATE INDEX "urn_edges_org_id_to_urn_idx" ON "urn_edges"("org_id", "to_urn");

-- AddForeignKey
ALTER TABLE "urn_edges" ADD CONSTRAINT "urn_edges_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "source_control_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
