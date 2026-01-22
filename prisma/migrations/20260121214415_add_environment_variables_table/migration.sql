-- CreateTable
CREATE TABLE "environment_variables" (
    "id" TEXT NOT NULL,
    "swarm_id" TEXT NOT NULL,
    "service_name" TEXT,
    "name" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "environment_variables_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "environment_variables_swarm_id_idx" ON "environment_variables"("swarm_id");

-- CreateIndex
CREATE UNIQUE INDEX "environment_variables_swarm_id_service_name_name_key" ON "environment_variables"("swarm_id", "service_name", "name");

-- AddForeignKey
ALTER TABLE "environment_variables" ADD CONSTRAINT "environment_variables_swarm_id_fkey" FOREIGN KEY ("swarm_id") REFERENCES "swarms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
