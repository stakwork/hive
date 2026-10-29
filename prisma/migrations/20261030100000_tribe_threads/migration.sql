-- CreateTable
CREATE TABLE "tribe_threads" (
    "id" TEXT NOT NULL,
    "tribe_link_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "mention_id" TEXT,
    "cursor" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tribe_threads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tribe_threads_conversation_id_key" ON "tribe_threads"("conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "tribe_threads_tribe_link_id_mention_id_key" ON "tribe_threads"("tribe_link_id", "mention_id");

-- AddForeignKey
ALTER TABLE "tribe_threads" ADD CONSTRAINT "tribe_threads_tribe_link_id_fkey" FOREIGN KEY ("tribe_link_id") REFERENCES "tribe_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tribe_threads" ADD CONSTRAINT "tribe_threads_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "shared_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A link's conversation becomes its first thread, under the link's own id:
-- the posts Jamie already holds (`<link id>:<row id>`) name it still.
INSERT INTO "tribe_threads" ("id", "tribe_link_id", "conversation_id", "cursor", "read_at", "created_at")
SELECT "id", "id", "conversation_id", "cursor", "read_at", "created_at"
FROM "tribe_links"
WHERE "conversation_id" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "tribe_links" DROP CONSTRAINT "tribe_links_conversation_id_fkey";

-- AlterTable
ALTER TABLE "tribe_links" DROP COLUMN "conversation_id",
DROP COLUMN "cursor",
DROP COLUMN "read_at";
