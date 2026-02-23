-- CreateTable
CREATE TABLE "whiteboard_messages" (
    "id" TEXT NOT NULL,
    "whiteboard_id" TEXT NOT NULL,
    "role" "ChatRole" NOT NULL,
    "content" TEXT NOT NULL,
    "status" "ChatStatus" NOT NULL DEFAULT 'SENT',
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whiteboard_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whiteboard_messages_whiteboard_id_idx" ON "whiteboard_messages"("whiteboard_id");

-- CreateIndex
CREATE INDEX "whiteboard_messages_created_at_idx" ON "whiteboard_messages"("created_at");

-- AddForeignKey
ALTER TABLE "whiteboard_messages" ADD CONSTRAINT "whiteboard_messages_whiteboard_id_fkey" FOREIGN KEY ("whiteboard_id") REFERENCES "whiteboards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whiteboard_messages" ADD CONSTRAINT "whiteboard_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
