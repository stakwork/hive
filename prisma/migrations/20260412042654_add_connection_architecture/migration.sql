-- CreateTable (idempotent guard in case add_connection_model was skipped)
CREATE TABLE IF NOT EXISTS "connections" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "diagram" TEXT,
    "open_api_spec" TEXT,
    "prompt" TEXT,
    "created_by" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (idempotent)
CREATE INDEX IF NOT EXISTS "connections_org_id_idx" ON "connections"("org_id");

-- AddForeignKey (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'connections_org_id_fkey'
  ) THEN
    ALTER TABLE "connections" ADD CONSTRAINT "connections_org_id_fkey"
      FOREIGN KEY ("org_id") REFERENCES "source_control_orgs"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AlterTable
ALTER TABLE "connections" ADD COLUMN IF NOT EXISTS "architecture" TEXT;
