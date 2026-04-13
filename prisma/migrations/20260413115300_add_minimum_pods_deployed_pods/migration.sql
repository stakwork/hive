ALTER TABLE "swarms" ADD COLUMN "minimum_pods" INTEGER;
ALTER TABLE "swarms" ADD COLUMN "deployed_pods" INTEGER;
-- Seed minimum_pods from current minimum_vms for all existing rows
UPDATE "swarms" SET "minimum_pods" = "minimum_vms";
