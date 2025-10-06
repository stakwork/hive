-- CreateEnum
CREATE TYPE "SourceControlOrgType" AS ENUM ('ORG', 'USER');

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "source_control_org_id" TEXT;

-- CreateTable
CREATE TABLE "source_control_orgs" (
    "id" TEXT NOT NULL,
    "type" "SourceControlOrgType" NOT NULL DEFAULT 'ORG',
    "githubLogin" TEXT NOT NULL,
    "github_installation_id" INTEGER NOT NULL,
    "name" TEXT,
    "avatar_url" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_control_orgs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_control_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "source_control_org_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "refresh_token" TEXT,
    "expires_at" TIMESTAMP(3),
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_control_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "source_control_orgs_githubLogin_key" ON "source_control_orgs"("githubLogin");

-- CreateIndex
CREATE UNIQUE INDEX "source_control_orgs_github_installation_id_key" ON "source_control_orgs"("github_installation_id");

-- CreateIndex
CREATE INDEX "source_control_orgs_githubLogin_idx" ON "source_control_orgs"("githubLogin");

-- CreateIndex
CREATE INDEX "source_control_orgs_github_installation_id_idx" ON "source_control_orgs"("github_installation_id");

-- CreateIndex
CREATE INDEX "source_control_tokens_user_id_idx" ON "source_control_tokens"("user_id");

-- CreateIndex
CREATE INDEX "source_control_tokens_source_control_org_id_idx" ON "source_control_tokens"("source_control_org_id");

-- CreateIndex
CREATE UNIQUE INDEX "source_control_tokens_user_id_source_control_org_id_key" ON "source_control_tokens"("user_id", "source_control_org_id");

-- CreateIndex
CREATE INDEX "workspaces_source_control_org_id_idx" ON "workspaces"("source_control_org_id");

-- AddForeignKey
ALTER TABLE "source_control_tokens" ADD CONSTRAINT "source_control_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_control_tokens" ADD CONSTRAINT "source_control_tokens_source_control_org_id_fkey" FOREIGN KEY ("source_control_org_id") REFERENCES "source_control_orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_source_control_org_id_fkey" FOREIGN KEY ("source_control_org_id") REFERENCES "source_control_orgs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
