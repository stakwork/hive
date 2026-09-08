-- CreateTable
CREATE TABLE "swarm_storage_snapshots" (
    "id" TEXT NOT NULL,
    "instance_id" TEXT NOT NULL,
    "swarm_id" TEXT,
    "date" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "reason_code" TEXT,
    "total_bytes" BIGINT,
    "used_bytes" BIGINT,
    "free_bytes" BIGINT,
    "mount" TEXT,
    "neo4j_size_bytes" BIGINT,
    "neo4j_size_known" BOOLEAN NOT NULL DEFAULT false,
    "services" JSONB NOT NULL DEFAULT '[]',
    "host_visible" BOOLEAN,
    "source" TEXT,
    "collected_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "swarm_storage_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "swarm_storage_snapshots_date_idx" ON "swarm_storage_snapshots"("date");

-- CreateIndex
CREATE INDEX "swarm_storage_snapshots_instance_id_idx" ON "swarm_storage_snapshots"("instance_id");

-- CreateIndex
CREATE UNIQUE INDEX "swarm_storage_snapshots_instance_id_date_key" ON "swarm_storage_snapshots"("instance_id", "date");

-- AddForeignKey
ALTER TABLE "swarm_storage_snapshots" ADD CONSTRAINT "swarm_storage_snapshots_swarm_id_fkey" FOREIGN KEY ("swarm_id") REFERENCES "swarms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
