import { BaseServiceClass } from "@/lib/base-service";
import { db } from "@/lib/db";
import type { ServiceConfig } from "@/types";
import type { EnsureWebhookParams, DeleteWebhookParams } from "@/types/github";
import crypto from "node:crypto";
import { parseGithubOwnerRepo } from "@/utils/repositoryParser";
import {
  listRepoHooks,
  createRepoHook,
  updateRepoHook,
  deleteRepoHook,
} from "@/services/github/api/webhooks";

export class WebhookService extends BaseServiceClass {
  public readonly serviceName = "githubWebhook";

  constructor(config: ServiceConfig) {
    super(config);
  }

  async ensureRepoWebhook({
    userId,
    workspaceId,
    repositoryUrl,
    callbackUrl,
    events = ["push", "pull_request"],
    active = true,
  }: EnsureWebhookParams): Promise<{ id: number; secret: string }> {
    const token = await this.getUserGithubAccessToken(userId);
    const { owner, repo } = parseGithubOwnerRepo(repositoryUrl);

    const repoRec = await db.repository.findUnique({
      where: {
        repositoryUrl_workspaceId: { repositoryUrl, workspaceId },
      },
    });
    if (!repoRec) throw new Error("Repository not found for workspace");

    const hooks = await listRepoHooks(token, owner, repo);
    const existing = hooks.find((h) => h.config?.url === callbackUrl);

    if (existing) {
      await updateRepoHook({
        token,
        owner,
        repo,
        hookId: existing.id,
        events,
        active,
      });
      const secret =
        repoRec.githubWebhookSecret || crypto.randomBytes(32).toString("hex");
      if (!repoRec.githubWebhookSecret) {
        await db.repository.update({
          where: { id: repoRec.id },
          data: {
            githubWebhookId: String(existing.id),
            githubWebhookSecret: secret,
          },
        });
      } else if (!repoRec.githubWebhookId) {
        await db.repository.update({
          where: { id: repoRec.id },
          data: { githubWebhookId: String(existing.id) },
        });
      }
      return { id: existing.id, secret };
    }

    const secret = crypto.randomBytes(32).toString("hex");
    const created = await createRepoHook({
      token,
      owner,
      repo,
      url: callbackUrl,
      secret,
      events,
      active,
    });

    await db.repository.update({
      where: { id: repoRec.id },
      data: {
        githubWebhookId: String(created.id),
        githubWebhookSecret: secret,
      },
    });

    return { id: created.id, secret };
  }

  async deleteRepoWebhook({
    userId,
    repositoryUrl,
    workspaceId,
  }: DeleteWebhookParams): Promise<void> {
    const token = await this.getUserGithubAccessToken(userId);
    const { owner, repo } = parseGithubOwnerRepo(repositoryUrl);

    const repoRec = await db.repository.findUnique({
      where: {
        repositoryUrl_workspaceId: { repositoryUrl, workspaceId },
      },
      select: { githubWebhookId: true },
    });
    if (!repoRec?.githubWebhookId) return;

    await deleteRepoHook(token, owner, repo, Number(repoRec.githubWebhookId));
    await db.repository.update({
      where: {
        repositoryUrl_workspaceId: { repositoryUrl, workspaceId },
      },
      data: {
        githubWebhookId: null,
        githubWebhookSecret: null,
      },
    });
  }

  private async getUserGithubAccessToken(userId: string): Promise<string> {
    const account = await db.account.findFirst({
      where: { userId, provider: "github" },
      select: { access_token: true },
    });
    if (!account?.access_token) {
      throw new Error("GitHub access token not found for user");
    }
    return account.access_token;
  }
}
