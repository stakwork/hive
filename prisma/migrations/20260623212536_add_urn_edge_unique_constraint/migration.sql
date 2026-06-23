-- CreateIndex
CREATE UNIQUE INDEX "urn_edges_org_id_from_urn_to_urn_type_key"
  ON "urn_edges"("org_id", "from_urn", "to_urn", "type");
