-- CreateEnum
CREATE TYPE "CanvasReviewReason" AS ENUM ('STALE_CONTENT', 'DANGLING_ENTITY_LINK', 'ARCHIVED_INITIATIVE_LINK', 'STALE_INITIATIVE');

-- CreateEnum
CREATE TYPE "CanvasReviewStatus" AS ENUM ('PENDING', 'DISMISSED', 'ACKNOWLEDGED', 'ACTIONED');

-- CreateTable
CREATE TABLE "canvas_janitor_configs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "schedule_interval_days" INTEGER NOT NULL DEFAULT 7,
    "last_run_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canvas_janitor_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canvas_janitor_runs" (
    "id" TEXT NOT NULL,
    "config_id" TEXT NOT NULL,
    "triggered_by" "JanitorTrigger" NOT NULL DEFAULT 'SCHEDULED',
    "triggered_by_user_id" TEXT,
    "status" "JanitorStatus" NOT NULL DEFAULT 'PENDING',
    "cards_created" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canvas_janitor_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canvas_review_cards" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "run_id" TEXT,
    "reason" "CanvasReviewReason" NOT NULL,
    "status" "CanvasReviewStatus" NOT NULL DEFAULT 'PENDING',
    "node_id" TEXT,
    "canvas_ref" TEXT,
    "node_text" TEXT,
    "node_category" TEXT,
    "entity_id" TEXT,
    "entity_name" TEXT,
    "reason_detail" TEXT,
    "dismissed_at" TIMESTAMP(3),
    "actioned_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canvas_review_cards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "canvas_janitor_configs_org_id_key" ON "canvas_janitor_configs"("org_id");

-- CreateIndex
CREATE INDEX "canvas_janitor_runs_config_id_idx" ON "canvas_janitor_runs"("config_id");

-- CreateIndex
CREATE INDEX "canvas_janitor_runs_status_idx" ON "canvas_janitor_runs"("status");

-- CreateIndex
CREATE INDEX "canvas_review_cards_org_id_user_id_status_idx" ON "canvas_review_cards"("org_id", "user_id", "status");

-- CreateIndex
CREATE INDEX "canvas_review_cards_org_id_idx" ON "canvas_review_cards"("org_id");

-- CreateIndex
CREATE INDEX "canvas_review_cards_user_id_idx" ON "canvas_review_cards"("user_id");

-- AddForeignKey
ALTER TABLE "canvas_janitor_configs" ADD CONSTRAINT "canvas_janitor_configs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "source_control_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canvas_janitor_runs" ADD CONSTRAINT "canvas_janitor_runs_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "canvas_janitor_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canvas_review_cards" ADD CONSTRAINT "canvas_review_cards_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "source_control_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canvas_review_cards" ADD CONSTRAINT "canvas_review_cards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canvas_review_cards" ADD CONSTRAINT "canvas_review_cards_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "canvas_janitor_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
