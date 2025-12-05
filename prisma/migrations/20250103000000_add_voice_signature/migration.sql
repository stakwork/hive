-- CreateTable
CREATE TABLE "voice_signatures" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "voice_embedding" TEXT NOT NULL,
    "sample_count" INTEGER NOT NULL DEFAULT 1,
    "last_updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_signatures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "voice_signatures_user_id_key" ON "voice_signatures"("user_id");

-- CreateIndex
CREATE INDEX "voice_signatures_user_id_idx" ON "voice_signatures"("user_id");

-- AddForeignKey
ALTER TABLE "voice_signatures" ADD CONSTRAINT "voice_signatures_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
