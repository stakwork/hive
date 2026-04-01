-- CreateTable
CREATE TABLE "ec2_alerts" (
    "id" TEXT NOT NULL,
    "instance_id" TEXT NOT NULL,
    "alarm_name" TEXT NOT NULL,
    "alarm_state" TEXT NOT NULL,
    "alarm_type" TEXT NOT NULL,
    "state_reason" TEXT NOT NULL,
    "triggered_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ec2_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ec2_alerts_instance_id_key" ON "ec2_alerts"("instance_id");
