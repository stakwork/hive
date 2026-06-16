-- AlterTable
ALTER TABLE "agent_logs"
  ADD COLUMN "provider" TEXT,
  ADD COLUMN "source"   TEXT,
  ADD COLUMN "repos"    TEXT[] NOT NULL DEFAULT '{}';
