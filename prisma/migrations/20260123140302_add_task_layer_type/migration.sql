-- CreateEnum
CREATE TYPE "TaskLayerType" AS ENUM ('DATABASE_SCHEMA', 'BACKEND_API', 'FRONTEND_COMPONENT', 'INTEGRATION_TEST', 'UNIT_TEST', 'E2E_TEST', 'CONFIG_INFRA', 'DOCUMENTATION');

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "layer_type" "TaskLayerType",
ADD COLUMN     "manual_layer_override" BOOLEAN;

-- CreateIndex
CREATE INDEX "tasks_layer_type_idx" ON "tasks"("layer_type");
