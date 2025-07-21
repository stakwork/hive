-- Convert snake_case column names to camelCase for consistency

-- Accounts table
ALTER TABLE "accounts" RENAME COLUMN "user_id" TO "userId";
ALTER TABLE "accounts" RENAME COLUMN "provider_account_id" TO "providerAccountId";
ALTER TABLE "accounts" RENAME COLUMN "refresh_token" TO "refreshToken";
ALTER TABLE "accounts" RENAME COLUMN "access_token" TO "accessToken";
ALTER TABLE "accounts" RENAME COLUMN "expires_at" TO "expiresAt";
ALTER TABLE "accounts" RENAME COLUMN "token_type" TO "tokenType";
ALTER TABLE "accounts" RENAME COLUMN "id_token" TO "idToken";
ALTER TABLE "accounts" RENAME COLUMN "session_state" TO "sessionState";

-- Sessions table
ALTER TABLE "sessions" RENAME COLUMN "session_token" TO "sessionToken";
ALTER TABLE "sessions" RENAME COLUMN "user_id" TO "userId";

-- Users table
ALTER TABLE "users" RENAME COLUMN "email_verified" TO "emailVerified";
ALTER TABLE "users" RENAME COLUMN "created_at" TO "createdAt";
ALTER TABLE "users" RENAME COLUMN "updated_at" TO "updatedAt";
ALTER TABLE "users" RENAME COLUMN "deleted_at" TO "deletedAt";
ALTER TABLE "users" RENAME COLUMN "last_login_at" TO "lastLoginAt";

-- GitHub Auth table
ALTER TABLE "github_auth" RENAME COLUMN "user_id" TO "userId";
ALTER TABLE "github_auth" RENAME COLUMN "github_user_id" TO "githubUserId";
ALTER TABLE "github_auth" RENAME COLUMN "github_username" TO "githubUsername";
ALTER TABLE "github_auth" RENAME COLUMN "github_node_id" TO "githubNodeId";
ALTER TABLE "github_auth" RENAME COLUMN "twitter_username" TO "twitterUsername";
ALTER TABLE "github_auth" RENAME COLUMN "public_repos" TO "publicRepos";
ALTER TABLE "github_auth" RENAME COLUMN "public_gists" TO "publicGists";
ALTER TABLE "github_auth" RENAME COLUMN "github_created_at" TO "githubCreatedAt";
ALTER TABLE "github_auth" RENAME COLUMN "github_updated_at" TO "githubUpdatedAt";
ALTER TABLE "github_auth" RENAME COLUMN "account_type" TO "accountType";
ALTER TABLE "github_auth" RENAME COLUMN "organizations_hash" TO "organizationsHash";
ALTER TABLE "github_auth" RENAME COLUMN "created_at" TO "createdAt";
ALTER TABLE "github_auth" RENAME COLUMN "updated_at" TO "updatedAt";

-- Workspaces table
ALTER TABLE "workspaces" RENAME COLUMN "deleted_at" TO "deletedAt";
ALTER TABLE "workspaces" RENAME COLUMN "created_at" TO "createdAt";
ALTER TABLE "workspaces" RENAME COLUMN "updated_at" TO "updatedAt";
ALTER TABLE "workspaces" RENAME COLUMN "owner_id" TO "ownerId";

-- Workspace Members table
ALTER TABLE "workspace_members" RENAME COLUMN "workspace_id" TO "workspaceId";
ALTER TABLE "workspace_members" RENAME COLUMN "user_id" TO "userId";
ALTER TABLE "workspace_members" RENAME COLUMN "joined_at" TO "joinedAt";
ALTER TABLE "workspace_members" RENAME COLUMN "left_at" TO "leftAt";

-- Swarms table
ALTER TABLE "swarms" RENAME COLUMN "swarm_id" TO "swarmId";
ALTER TABLE "swarms" RENAME COLUMN "swarm_url" TO "swarmUrl";
ALTER TABLE "swarms" RENAME COLUMN "instance_type" TO "instanceType";
ALTER TABLE "swarms" RENAME COLUMN "created_at" TO "createdAt";
ALTER TABLE "swarms" RENAME COLUMN "updated_at" TO "updatedAt";
ALTER TABLE "swarms" RENAME COLUMN "pool_name" TO "poolName";
ALTER TABLE "swarms" RENAME COLUMN "repository_name" TO "repositoryName";
ALTER TABLE "swarms" RENAME COLUMN "repository_description" TO "repositoryDescription";
ALTER TABLE "swarms" RENAME COLUMN "repository_url" TO "repositoryUrl";
ALTER TABLE "swarms" RENAME COLUMN "swarm_api_key" TO "swarmApiKey";
ALTER TABLE "swarms" RENAME COLUMN "swarm_secret_alias" TO "swarmSecretAlias";
ALTER TABLE "swarms" RENAME COLUMN "pool_api_key" TO "poolApiKey";
ALTER TABLE "swarms" RENAME COLUMN "environment_variables" TO "environmentVariables";
ALTER TABLE "swarms" RENAME COLUMN "workspace_id" TO "workspaceId";

-- Repositories table
ALTER TABLE "repositories" RENAME COLUMN "repository_url" TO "repositoryUrl";
ALTER TABLE "repositories" RENAME COLUMN "created_at" TO "createdAt";
ALTER TABLE "repositories" RENAME COLUMN "updated_at" TO "updatedAt";
ALTER TABLE "repositories" RENAME COLUMN "workspace_id" TO "workspaceId";

-- Products table
ALTER TABLE "products" RENAME COLUMN "workspace_id" TO "workspaceId";
ALTER TABLE "products" RENAME COLUMN "deleted_at" TO "deletedAt";
ALTER TABLE "products" RENAME COLUMN "created_at" TO "createdAt";
ALTER TABLE "products" RENAME COLUMN "updated_at" TO "updatedAt";

-- Features table
ALTER TABLE "features" RENAME COLUMN "product_id" TO "productId";
ALTER TABLE "features" RENAME COLUMN "parent_id" TO "parentId";
ALTER TABLE "features" RENAME COLUMN "created_by_id" TO "createdById";
ALTER TABLE "features" RENAME COLUMN "updated_by_id" TO "updatedById";
ALTER TABLE "features" RENAME COLUMN "deleted_at" TO "deletedAt";
ALTER TABLE "features" RENAME COLUMN "created_at" TO "createdAt";
ALTER TABLE "features" RENAME COLUMN "updated_at" TO "updatedAt";

-- User Stories table
ALTER TABLE "user_stories" RENAME COLUMN "acceptance_criteria" TO "acceptanceCriteria";
ALTER TABLE "user_stories" RENAME COLUMN "feature_id" TO "featureId";
ALTER TABLE "user_stories" RENAME COLUMN "story_points" TO "storyPoints";
ALTER TABLE "user_stories" RENAME COLUMN "created_by_id" TO "createdById";
ALTER TABLE "user_stories" RENAME COLUMN "updated_by_id" TO "updatedById";
ALTER TABLE "user_stories" RENAME COLUMN "deleted_at" TO "deletedAt";
ALTER TABLE "user_stories" RENAME COLUMN "created_at" TO "createdAt";
ALTER TABLE "user_stories" RENAME COLUMN "updated_at" TO "updatedAt";

-- Requirements table
ALTER TABLE "requirements" RENAME COLUMN "feature_id" TO "featureId";
ALTER TABLE "requirements" RENAME COLUMN "deleted_at" TO "deletedAt";
ALTER TABLE "requirements" RENAME COLUMN "created_at" TO "createdAt";
ALTER TABLE "requirements" RENAME COLUMN "updated_at" TO "updatedAt";

-- Tasks table
ALTER TABLE "tasks" RENAME COLUMN "workspace_id" TO "workspaceId";
ALTER TABLE "tasks" RENAME COLUMN "assignee_id" TO "assigneeId";
ALTER TABLE "tasks" RENAME COLUMN "repository_id" TO "repositoryId";
ALTER TABLE "tasks" RENAME COLUMN "estimated_hours" TO "estimatedHours";
ALTER TABLE "tasks" RENAME COLUMN "actual_hours" TO "actualHours";
ALTER TABLE "tasks" RENAME COLUMN "created_by_id" TO "createdById";
ALTER TABLE "tasks" RENAME COLUMN "updated_by_id" TO "updatedById";
ALTER TABLE "tasks" RENAME COLUMN "deleted_at" TO "deletedAt";
ALTER TABLE "tasks" RENAME COLUMN "created_at" TO "createdAt";
ALTER TABLE "tasks" RENAME COLUMN "updated_at" TO "updatedAt";

-- Chat Messages table
ALTER TABLE "chat_messages" RENAME COLUMN "task_id" TO "taskId";
ALTER TABLE "chat_messages" RENAME COLUMN "source_websocket_id" TO "sourceWebsocketId";
ALTER TABLE "chat_messages" RENAME COLUMN "created_at" TO "createdAt";
ALTER TABLE "chat_messages" RENAME COLUMN "updated_at" TO "updatedAt";

-- Artifacts table
ALTER TABLE "artifacts" RENAME COLUMN "message_id" TO "messageId";
ALTER TABLE "artifacts" RENAME COLUMN "created_at" TO "createdAt";
ALTER TABLE "artifacts" RENAME COLUMN "updated_at" TO "updatedAt";

-- Roadmaps table
ALTER TABLE "roadmaps" RENAME COLUMN "product_id" TO "productId";
ALTER TABLE "roadmaps" RENAME COLUMN "start_date" TO "startDate";
ALTER TABLE "roadmaps" RENAME COLUMN "end_date" TO "endDate";
ALTER TABLE "roadmaps" RENAME COLUMN "deleted_at" TO "deletedAt";
ALTER TABLE "roadmaps" RENAME COLUMN "created_at" TO "createdAt";
ALTER TABLE "roadmaps" RENAME COLUMN "updated_at" TO "updatedAt";

-- Roadmap Items table
ALTER TABLE "roadmap_items" RENAME COLUMN "roadmap_id" TO "roadmapId";
ALTER TABLE "roadmap_items" RENAME COLUMN "feature_id" TO "featureId";
ALTER TABLE "roadmap_items" RENAME COLUMN "planned_start_date" TO "plannedStartDate";
ALTER TABLE "roadmap_items" RENAME COLUMN "planned_end_date" TO "plannedEndDate";
ALTER TABLE "roadmap_items" RENAME COLUMN "actual_start_date" TO "actualStartDate";
ALTER TABLE "roadmap_items" RENAME COLUMN "actual_end_date" TO "actualEndDate";
ALTER TABLE "roadmap_items" RENAME COLUMN "created_at" TO "createdAt";
ALTER TABLE "roadmap_items" RENAME COLUMN "updated_at" TO "updatedAt";

-- Comments table
ALTER TABLE "comments" RENAME COLUMN "feature_id" TO "featureId";
ALTER TABLE "comments" RENAME COLUMN "user_story_id" TO "userStoryId";
ALTER TABLE "comments" RENAME COLUMN "task_id" TO "taskId";
ALTER TABLE "comments" RENAME COLUMN "requirement_id" TO "requirementId";
ALTER TABLE "comments" RENAME COLUMN "parent_id" TO "parentId";
ALTER TABLE "comments" RENAME COLUMN "author_id" TO "authorId";
ALTER TABLE "comments" RENAME COLUMN "deleted_at" TO "deletedAt";
ALTER TABLE "comments" RENAME COLUMN "created_at" TO "createdAt";
ALTER TABLE "comments" RENAME COLUMN "updated_at" TO "updatedAt";