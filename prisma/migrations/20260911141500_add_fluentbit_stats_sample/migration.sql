-- CreateTable
CREATE TABLE "fluentbit_stats_samples" (
    "id" TEXT NOT NULL,
    "instance_id" TEXT NOT NULL,
    "swarm_id" TEXT,
    "collected_at" TIMESTAMP(3) NOT NULL,
    "input_bytes" BIGINT,
    "input_records" BIGINT,
    "containers" JSONB,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fluentbit_stats_samples_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fluentbit_stats_samples_instance_id_collected_at_idx" ON "fluentbit_stats_samples"("instance_id", "collected_at");

-- AddForeignKey
ALTER TABLE "fluentbit_stats_samples" ADD CONSTRAINT "fluentbit_stats_samples_swarm_id_fkey" FOREIGN KEY ("swarm_id") REFERENCES "swarms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
