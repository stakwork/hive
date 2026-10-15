-- A job turn whose launch strut accepted with a jobCallback (strut plans/live-artifacts.md).
ALTER TABLE "strut_runs" ADD COLUMN "live_updates" BOOLEAN NOT NULL DEFAULT false;
