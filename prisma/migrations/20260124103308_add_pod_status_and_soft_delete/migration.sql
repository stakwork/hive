-- AlterEnum
-- Add new PodStatus enum values (idempotent)
-- Only alter if the enum type exists (handles shadow DB scenario)
DO $$ 
DECLARE
  enum_oid OID;
BEGIN
  -- Get the OID of the PodStatus enum type if it exists
  SELECT oid INTO enum_oid FROM pg_type WHERE typname = 'PodStatus';
  
  IF enum_oid IS NOT NULL THEN
    -- Add STARTING if not exists
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'STARTING' AND enumtypid = enum_oid) THEN
      ALTER TYPE "PodStatus" ADD VALUE 'STARTING';
    END IF;
    -- Add CREATING if not exists
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'CREATING' AND enumtypid = enum_oid) THEN
      ALTER TYPE "PodStatus" ADD VALUE 'CREATING';
    END IF;
    -- Add MOTHBALLED if not exists
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'MOTHBALLED' AND enumtypid = enum_oid) THEN
      ALTER TYPE "PodStatus" ADD VALUE 'MOTHBALLED';
    END IF;
    -- Add CRASHING if not exists
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'CRASHING' AND enumtypid = enum_oid) THEN
      ALTER TYPE "PodStatus" ADD VALUE 'CRASHING';
    END IF;
    -- Add UNSTABLE if not exists
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'UNSTABLE' AND enumtypid = enum_oid) THEN
      ALTER TYPE "PodStatus" ADD VALUE 'UNSTABLE';
    END IF;
  END IF;
END $$;

-- AlterTable
-- Add deleted_at column (idempotent)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pods' AND column_name = 'deleted_at') THEN
    ALTER TABLE "pods" ADD COLUMN "deleted_at" TIMESTAMP(3);
  END IF;
END $$;

-- CreateIndex
-- Add index on deleted_at (idempotent)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'pods' AND indexname = 'pods_deleted_at_idx') THEN
    CREATE INDEX "pods_deleted_at_idx" ON "pods"("deleted_at");
  END IF;
END $$;
