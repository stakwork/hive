/*
  Warnings:

  - Made the column `node_type_order` on table `workspaces` required. This step will fail if there are existing NULL values in that column.

*/
-- Update existing NULL values
UPDATE "workspaces"
SET "node_type_order" = '[{"type":"Function","value":20},{"type":"Feature","value":20},{"type":"File","value":20},{"type":"Endpoint","value":20},{"type":"Person","value":20},{"type":"Episode","value":20},{"type":"Call","value":20},{"type":"Message","value":20}]'
WHERE "node_type_order" IS NULL;

-- AlterTable
ALTER TABLE "workspaces" ALTER COLUMN "node_type_order" SET NOT NULL,
ALTER COLUMN "node_type_order" SET DEFAULT '[{"type":"Function","value":20},{"type":"Feature","value":20},{"type":"File","value":20},{"type":"Endpoint","value":20},{"type":"Person","value":20},{"type":"Episode","value":20},{"type":"Call","value":20},{"type":"Message","value":20}]';
