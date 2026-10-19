-- Which engine answers the org canvas chat: "hive" (the canvas agent, today) or "strut" (the strut orchestrator workflow).
ALTER TABLE "source_control_orgs" ADD COLUMN "jamie_engine" TEXT NOT NULL DEFAULT 'hive';
