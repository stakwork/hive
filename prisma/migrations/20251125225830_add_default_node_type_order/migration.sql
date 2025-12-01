ALTER TABLE "workspaces"
ADD COLUMN IF NOT EXISTS "node_type_order" JSONB
DEFAULT '[{"type":"Function","value":20},{"type":"Feature","value":20},{"type":"File","value":20},{"type":"Endpoint","value":20},{"type":"Person","value":20},{"type":"Episode","value":20},{"type":"Call","value":20},{"type":"Message","value":20}]'
NOT NULL;
