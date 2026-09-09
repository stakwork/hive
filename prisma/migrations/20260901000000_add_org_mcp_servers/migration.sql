-- CreateTable
CREATE TABLE "org_mcp_servers" (
    "id" TEXT NOT NULL,
    "source_control_org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "headers" TEXT,
    "tool_filter" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_mcp_servers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "org_mcp_servers_source_control_org_id_idx" ON "org_mcp_servers"("source_control_org_id");

-- CreateIndex
CREATE UNIQUE INDEX "org_mcp_servers_source_control_org_id_name_key" ON "org_mcp_servers"("source_control_org_id", "name");

-- AddForeignKey
ALTER TABLE "org_mcp_servers" ADD CONSTRAINT "org_mcp_servers_source_control_org_id_fkey" FOREIGN KEY ("source_control_org_id") REFERENCES "source_control_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

