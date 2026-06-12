-- AlterTable
ALTER TABLE "milestones" ADD COLUMN     "creator_id" TEXT;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
