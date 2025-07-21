-- RenameForeignKey
ALTER TABLE "accounts" RENAME CONSTRAINT "accounts_user_id_fkey" TO "accounts_userId_fkey";

-- RenameForeignKey
ALTER TABLE "artifacts" RENAME CONSTRAINT "artifacts_message_id_fkey" TO "artifacts_messageId_fkey";

-- RenameForeignKey
ALTER TABLE "chat_messages" RENAME CONSTRAINT "chat_messages_task_id_fkey" TO "chat_messages_taskId_fkey";

-- RenameForeignKey
ALTER TABLE "comments" RENAME CONSTRAINT "comments_author_id_fkey" TO "comments_authorId_fkey";

-- RenameForeignKey
ALTER TABLE "comments" RENAME CONSTRAINT "comments_feature_id_fkey" TO "comments_featureId_fkey";

-- RenameForeignKey
ALTER TABLE "comments" RENAME CONSTRAINT "comments_parent_id_fkey" TO "comments_parentId_fkey";

-- RenameForeignKey
ALTER TABLE "comments" RENAME CONSTRAINT "comments_requirement_id_fkey" TO "comments_requirementId_fkey";

-- RenameForeignKey
ALTER TABLE "comments" RENAME CONSTRAINT "comments_task_id_fkey" TO "comments_taskId_fkey";

-- RenameForeignKey
ALTER TABLE "comments" RENAME CONSTRAINT "comments_user_story_id_fkey" TO "comments_userStoryId_fkey";

-- RenameForeignKey
ALTER TABLE "features" RENAME CONSTRAINT "features_created_by_id_fkey" TO "features_createdById_fkey";

-- RenameForeignKey
ALTER TABLE "features" RENAME CONSTRAINT "features_parent_id_fkey" TO "features_parentId_fkey";

-- RenameForeignKey
ALTER TABLE "features" RENAME CONSTRAINT "features_product_id_fkey" TO "features_productId_fkey";

-- RenameForeignKey
ALTER TABLE "features" RENAME CONSTRAINT "features_updated_by_id_fkey" TO "features_updatedById_fkey";

-- RenameForeignKey
ALTER TABLE "github_auth" RENAME CONSTRAINT "github_auth_user_id_fkey" TO "github_auth_userId_fkey";

-- RenameForeignKey
ALTER TABLE "products" RENAME CONSTRAINT "products_workspace_id_fkey" TO "products_workspaceId_fkey";

-- RenameForeignKey
ALTER TABLE "repositories" RENAME CONSTRAINT "repositories_workspace_id_fkey" TO "repositories_workspaceId_fkey";

-- RenameForeignKey
ALTER TABLE "requirements" RENAME CONSTRAINT "requirements_feature_id_fkey" TO "requirements_featureId_fkey";

-- RenameForeignKey
ALTER TABLE "roadmap_items" RENAME CONSTRAINT "roadmap_items_feature_id_fkey" TO "roadmap_items_featureId_fkey";

-- RenameForeignKey
ALTER TABLE "roadmap_items" RENAME CONSTRAINT "roadmap_items_roadmap_id_fkey" TO "roadmap_items_roadmapId_fkey";

-- RenameForeignKey
ALTER TABLE "roadmaps" RENAME CONSTRAINT "roadmaps_product_id_fkey" TO "roadmaps_productId_fkey";

-- RenameForeignKey
ALTER TABLE "sessions" RENAME CONSTRAINT "sessions_user_id_fkey" TO "sessions_userId_fkey";

-- RenameForeignKey
ALTER TABLE "swarms" RENAME CONSTRAINT "swarms_workspace_id_fkey" TO "swarms_workspaceId_fkey";

-- RenameForeignKey
ALTER TABLE "tasks" RENAME CONSTRAINT "tasks_assignee_id_fkey" TO "tasks_assigneeId_fkey";

-- RenameForeignKey
ALTER TABLE "tasks" RENAME CONSTRAINT "tasks_created_by_id_fkey" TO "tasks_createdById_fkey";

-- RenameForeignKey
ALTER TABLE "tasks" RENAME CONSTRAINT "tasks_repository_id_fkey" TO "tasks_repositoryId_fkey";

-- RenameForeignKey
ALTER TABLE "tasks" RENAME CONSTRAINT "tasks_updated_by_id_fkey" TO "tasks_updatedById_fkey";

-- RenameForeignKey
ALTER TABLE "tasks" RENAME CONSTRAINT "tasks_workspace_id_fkey" TO "tasks_workspaceId_fkey";

-- RenameForeignKey
ALTER TABLE "user_stories" RENAME CONSTRAINT "user_stories_created_by_id_fkey" TO "user_stories_createdById_fkey";

-- RenameForeignKey
ALTER TABLE "user_stories" RENAME CONSTRAINT "user_stories_feature_id_fkey" TO "user_stories_featureId_fkey";

-- RenameForeignKey
ALTER TABLE "user_stories" RENAME CONSTRAINT "user_stories_updated_by_id_fkey" TO "user_stories_updatedById_fkey";

-- RenameForeignKey
ALTER TABLE "workspace_members" RENAME CONSTRAINT "workspace_members_user_id_fkey" TO "workspace_members_userId_fkey";

-- RenameForeignKey
ALTER TABLE "workspace_members" RENAME CONSTRAINT "workspace_members_workspace_id_fkey" TO "workspace_members_workspaceId_fkey";

-- RenameForeignKey
ALTER TABLE "workspaces" RENAME CONSTRAINT "workspaces_owner_id_fkey" TO "workspaces_ownerId_fkey";

-- RenameIndex
ALTER INDEX "accounts_provider_provider_account_id_key" RENAME TO "accounts_provider_providerAccountId_key";

-- RenameIndex
ALTER INDEX "artifacts_message_id_idx" RENAME TO "artifacts_messageId_idx";

-- RenameIndex
ALTER INDEX "chat_messages_task_id_idx" RENAME TO "chat_messages_taskId_idx";

-- RenameIndex
ALTER INDEX "comments_author_id_idx" RENAME TO "comments_authorId_idx";

-- RenameIndex
ALTER INDEX "comments_feature_id_idx" RENAME TO "comments_featureId_idx";

-- RenameIndex
ALTER INDEX "comments_requirement_id_idx" RENAME TO "comments_requirementId_idx";

-- RenameIndex
ALTER INDEX "comments_task_id_idx" RENAME TO "comments_taskId_idx";

-- RenameIndex
ALTER INDEX "comments_user_story_id_idx" RENAME TO "comments_userStoryId_idx";

-- RenameIndex
ALTER INDEX "features_parent_id_idx" RENAME TO "features_parentId_idx";

-- RenameIndex
ALTER INDEX "features_product_id_idx" RENAME TO "features_productId_idx";

-- RenameIndex
ALTER INDEX "github_auth_github_user_id_idx" RENAME TO "github_auth_githubUserId_idx";

-- RenameIndex
ALTER INDEX "github_auth_github_username_idx" RENAME TO "github_auth_githubUsername_idx";

-- RenameIndex
ALTER INDEX "github_auth_user_id_key" RENAME TO "github_auth_userId_key";

-- RenameIndex
ALTER INDEX "products_workspace_id_idx" RENAME TO "products_workspaceId_idx";

-- RenameIndex
ALTER INDEX "repositories_repository_url_workspace_id_key" RENAME TO "repositories_repositoryUrl_workspaceId_key";

-- RenameIndex
ALTER INDEX "repositories_workspace_id_idx" RENAME TO "repositories_workspaceId_idx";

-- RenameIndex
ALTER INDEX "requirements_feature_id_idx" RENAME TO "requirements_featureId_idx";

-- RenameIndex
ALTER INDEX "roadmap_items_feature_id_idx" RENAME TO "roadmap_items_featureId_idx";

-- RenameIndex
ALTER INDEX "roadmap_items_roadmap_id_feature_id_key" RENAME TO "roadmap_items_roadmapId_featureId_key";

-- RenameIndex
ALTER INDEX "roadmap_items_roadmap_id_idx" RENAME TO "roadmap_items_roadmapId_idx";

-- RenameIndex
ALTER INDEX "roadmaps_product_id_idx" RENAME TO "roadmaps_productId_idx";

-- RenameIndex
ALTER INDEX "sessions_session_token_key" RENAME TO "sessions_sessionToken_key";

-- RenameIndex
ALTER INDEX "swarms_swarm_id_idx" RENAME TO "swarms_swarmId_idx";

-- RenameIndex
ALTER INDEX "swarms_workspace_id_key" RENAME TO "swarms_workspaceId_key";

-- RenameIndex
ALTER INDEX "tasks_assignee_id_idx" RENAME TO "tasks_assigneeId_idx";

-- RenameIndex
ALTER INDEX "tasks_workspace_id_idx" RENAME TO "tasks_workspaceId_idx";

-- RenameIndex
ALTER INDEX "user_stories_feature_id_idx" RENAME TO "user_stories_featureId_idx";

-- RenameIndex
ALTER INDEX "users_created_at_idx" RENAME TO "users_createdAt_idx";

-- RenameIndex
ALTER INDEX "workspace_members_user_id_idx" RENAME TO "workspace_members_userId_idx";

-- RenameIndex
ALTER INDEX "workspace_members_workspace_id_idx" RENAME TO "workspace_members_workspaceId_idx";

-- RenameIndex
ALTER INDEX "workspace_members_workspace_id_user_id_key" RENAME TO "workspace_members_workspaceId_userId_key";

-- RenameIndex
ALTER INDEX "workspaces_owner_id_idx" RENAME TO "workspaces_ownerId_idx";
