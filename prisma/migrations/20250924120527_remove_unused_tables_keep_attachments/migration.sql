/*
  Warnings:

  - You are about to drop the `comments` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `features` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `products` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `requirements` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `roadmap_items` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `roadmaps` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `user_stories` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `verification_tokens` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "comments" DROP CONSTRAINT "comments_author_id_fkey";

-- DropForeignKey
ALTER TABLE "comments" DROP CONSTRAINT "comments_feature_id_fkey";

-- DropForeignKey
ALTER TABLE "comments" DROP CONSTRAINT "comments_parent_id_fkey";

-- DropForeignKey
ALTER TABLE "comments" DROP CONSTRAINT "comments_requirement_id_fkey";

-- DropForeignKey
ALTER TABLE "comments" DROP CONSTRAINT "comments_task_id_fkey";

-- DropForeignKey
ALTER TABLE "comments" DROP CONSTRAINT "comments_user_story_id_fkey";

-- DropForeignKey
ALTER TABLE "features" DROP CONSTRAINT "features_created_by_id_fkey";

-- DropForeignKey
ALTER TABLE "features" DROP CONSTRAINT "features_parent_id_fkey";

-- DropForeignKey
ALTER TABLE "features" DROP CONSTRAINT "features_product_id_fkey";

-- DropForeignKey
ALTER TABLE "features" DROP CONSTRAINT "features_updated_by_id_fkey";

-- DropForeignKey
ALTER TABLE "products" DROP CONSTRAINT "products_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "requirements" DROP CONSTRAINT "requirements_feature_id_fkey";

-- DropForeignKey
ALTER TABLE "roadmap_items" DROP CONSTRAINT "roadmap_items_feature_id_fkey";

-- DropForeignKey
ALTER TABLE "roadmap_items" DROP CONSTRAINT "roadmap_items_roadmap_id_fkey";

-- DropForeignKey
ALTER TABLE "roadmaps" DROP CONSTRAINT "roadmaps_product_id_fkey";

-- DropForeignKey
ALTER TABLE "user_stories" DROP CONSTRAINT "user_stories_created_by_id_fkey";

-- DropForeignKey
ALTER TABLE "user_stories" DROP CONSTRAINT "user_stories_feature_id_fkey";

-- DropForeignKey
ALTER TABLE "user_stories" DROP CONSTRAINT "user_stories_updated_by_id_fkey";

-- DropTable
DROP TABLE "comments";

-- DropTable
DROP TABLE "features";

-- DropTable
DROP TABLE "products";

-- DropTable
DROP TABLE "requirements";

-- DropTable
DROP TABLE "roadmap_items";

-- DropTable
DROP TABLE "roadmaps";

-- DropTable
DROP TABLE "user_stories";

-- DropTable
DROP TABLE "verification_tokens";

-- DropEnum
DROP TYPE "CommentEntity";

-- DropEnum
DROP TYPE "FeatureStatus";

-- DropEnum
DROP TYPE "MoSCoWPriority";

-- DropEnum
DROP TYPE "RequirementStatus";

-- DropEnum
DROP TYPE "RequirementType";

-- DropEnum
DROP TYPE "StoryStatus";

-- DropEnum
DROP TYPE "TimeHorizon";
