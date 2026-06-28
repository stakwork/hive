-- AlterEnum
ALTER TYPE "NotificationTriggerStatus" ADD VALUE 'SUPPRESSED';

-- CreateTable
CREATE TABLE "user_feature_presence" (
    "user_id"       TEXT NOT NULL,
    "feature_id"    TEXT NOT NULL,
    "last_seen_at"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_feature_presence_pkey" PRIMARY KEY ("user_id","feature_id")
);

-- CreateIndex
CREATE INDEX "user_feature_presence_user_id_feature_id_last_seen_at_idx"
  ON "user_feature_presence"("user_id", "feature_id", "last_seen_at");

-- AddForeignKey
ALTER TABLE "user_feature_presence"
  ADD CONSTRAINT "user_feature_presence_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_feature_presence"
  ADD CONSTRAINT "user_feature_presence_feature_id_fkey"
  FOREIGN KEY ("feature_id") REFERENCES "features"("id") ON DELETE CASCADE ON UPDATE CASCADE;
