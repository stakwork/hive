-- AlterTable
ALTER TABLE "janitor_configs" ADD COLUMN     "recommendation_sweep_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ticket_sweep_enabled" BOOLEAN NOT NULL DEFAULT false;
